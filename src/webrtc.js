import { supabase } from './supabase';

let peers = {}; // userId -> { pc, remoteStream }
let localStreamRef = null;
let activeChannel = null;
let dbChannel = null;
let callbacksRef = null;
let currentUserId = null;
let currentRoomId = null;

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

/**
 * Get active peer connections dictionary (useful for debugging/states)
 */
export function getPeers() {
  return peers;
}

/**
 * Get active peer connection instance (for backward compatibility, returns the first active peer)
 */
export function getPeerConnection() {
  const keys = Object.keys(peers);
  return keys.length > 0 ? peers[keys[0]].pc : null;
}

/**
 * Initialize WebRTC Peer Connection and set up MESH signaling using Supabase Realtime Broadcast & Presence
 */
export async function startSignaling(
  roomId,
  userId,
  isHost, // keeps roles in sync
  localStream,
  callbacks = {}
) {
  currentRoomId = roomId;
  currentUserId = userId;
  localStreamRef = localStream;
  callbacksRef = callbacks;

  const {
    onRemoteStream,
    onRemoteStreamRemoved,
    onConnectionState,
    onRoomUpdate,
    onRoomDeleted,
    onError
  } = callbacks;

  try {
    console.log(`Iniciando señalización MESH WebRTC para sala ${roomId} y usuario ${userId}`);

    // Create Supabase Realtime Channel for active MESH voice signaling
    activeChannel = supabase.channel(`room_call_${roomId}`, {
      config: {
        presence: {
          key: userId
        }
      }
    });

    // 1. Listen to Presence Synchronization
    activeChannel
      .on('presence', { event: 'sync' }, () => {
        const presenceState = activeChannel.presenceState();
        handlePresenceSync(presenceState);
      })
      .on('presence', { event: 'join', key: '*' }, ({ newPresences }) => {
        console.log('Nuevos usuarios detectados en presencia:', newPresences);
      })
      .on('presence', { event: 'leave', key: '*' }, ({ leftPresences }) => {
        console.log('Usuarios salieron de presencia:', leftPresences);
      });

    // 2. Listen to incoming Broadcast Signaling (SDP Offers/Answers & ICE Candidates)
    activeChannel.on('broadcast', { event: 'signal' }, async ({ payload }) => {
      // Only process signals intended for me
      if (payload.target_id !== userId) return;

      const senderId = payload.sender_id;
      console.log(`Señal MESH recibida de ${senderId}:`, payload.sdp ? payload.sdp.type : 'ICE');

      // Create peer connection if not already created
      let peer = peers[senderId];
      if (!peer) {
        peer = await createPeerConnection(senderId);
      }

      const pc = peer.pc;

      if (payload.sdp) {
        const sdp = payload.sdp;
        if (sdp.type === 'offer') {
          console.log(`Oferta SDP recibida de ${senderId}. Estableciendo descripción remota...`);
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          
          console.log(`Creando respuesta SDP para ${senderId}...`);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          // Broadcast answer back to sender
          activeChannel.send({
            type: 'broadcast',
            event: 'signal',
            payload: {
              sender_id: userId,
              target_id: senderId,
              sdp: answer
            }
          });

          // Add any pending candidates
          if (pc.pendingCandidates) {
            console.log(`Agregando ${pc.pendingCandidates.length} candidatos ICE guardados para ${senderId}`);
            for (const cand of pc.pendingCandidates) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(cand));
              } catch (e) {
                console.error('Error al agregar candidato ICE guardado:', e);
              }
            }
            pc.pendingCandidates = [];
          }
        } else if (sdp.type === 'answer') {
          console.log(`Respuesta SDP recibida de ${senderId}. Estableciendo descripción remota...`);
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        }
      } else if (payload.ice) {
        try {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(payload.ice));
          } else {
            if (!pc.pendingCandidates) pc.pendingCandidates = [];
            pc.pendingCandidates.push(payload.ice);
          }
        } catch (err) {
          console.error(`Error al agregar candidato ICE para ${senderId}:`, err);
        }
      }
    });

    // 3. Listen to database DELETES on the room
    dbChannel = supabase
      .channel(`room_db_delete_${roomId}`)
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        async () => {
          console.log('La sala ha sido eliminada de la base de datos por el host.');
          if (onRoomDeleted) {
            await onRoomDeleted();
          }
        }
      )
      .subscribe();

    // Subscribe to voice channel and track presence metadata
    activeChannel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        console.log('¡Canal MESH en vivo suscrito con éxito!');
        
        // Retrieve local profile username from window/main state or default
        const localUsername = window.currentUserUsername || 'Rider';
        await activeChannel.track({
          userId: userId,
          username: localUsername,
          isHost: isHost,
          joinedAt: new Date().toISOString()
        });
      }
    });

  } catch (err) {
    console.error('Error al inicializar señalización MESH WebRTC:', err);
    if (onError) onError(err);
  }
}

/**
 * Handle active Presence synchronizations
 */
async function handlePresenceSync(presenceState) {
  if (!presenceState) return;

  // Extract all connected user profiles in the presence list
  const activePresences = [];
  Object.values(presenceState).forEach(list => {
    if (list && list[0]) {
      activePresences.push(list[0]);
    }
  });

  console.log('Presencia MESH sincronizada. Conectados:', activePresences.length);

  const activeUserIds = activePresences.map(p => p.userId);

  // 1. Establish connection to newly joined peers
  for (const presence of activePresences) {
    const otherUserId = presence.userId;
    if (otherUserId === currentUserId) continue;

    // Create connection if it doesn't exist
    if (!peers[otherUserId]) {
      const peer = await createPeerConnection(otherUserId);
      const pc = peer.pc;

      // Determine Offer/Answer roles. Smallest UUID creates and sends SDP offer!
      if (currentUserId < otherUserId) {
        console.log(`[MESH ROLE] Soy iniciador para peer ${otherUserId}. Generando oferta...`);
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);

        activeChannel.send({
          type: 'broadcast',
          event: 'signal',
          payload: {
            sender_id: currentUserId,
            target_id: otherUserId,
            sdp: offer
          }
        });
      } else {
        console.log(`[MESH ROLE] Soy receptor para peer ${otherUserId}. Esperando oferta...`);
      }
    }
  }

  // 2. Remove peers who have left the room
  for (const peerId of Object.keys(peers)) {
    if (!activeUserIds.includes(peerId)) {
      console.log(`El peer ${peerId} ha salido. Removiendo conexión...`);
      removePeer(peerId);
    }
  }

  // 3. Fire room list updates so the UI reflects all participants in real time
  if (callbacksRef && callbacksRef.onRoomUpdate) {
    callbacksRef.onRoomUpdate(activePresences);
  }
}

/**
 * Create RTCPeerConnection for a specific remote peer ID
 */
async function createPeerConnection(targetUserId) {
  console.log(`Estableciendo RTCPeerConnection para peer: ${targetUserId}`);

  const pc = new RTCPeerConnection(rtcConfig);

  // Store in connection dictionary
  peers[targetUserId] = { pc, remoteStream: null };

  // Add local media stream
  if (localStreamRef) {
    localStreamRef.getTracks().forEach(track => {
      pc.addTrack(track, localStreamRef);
    });
  }

  // Gather local ICE candidates and broadcast to target peer
  pc.onicecandidate = (event) => {
    if (event.candidate && activeChannel) {
      activeChannel.send({
        type: 'broadcast',
        event: 'signal',
        payload: {
          sender_id: currentUserId,
          target_id: targetUserId,
          ice: event.candidate.toJSON()
        }
      });
    }
  };

  // Receive remote streams
  pc.ontrack = (event) => {
    console.log(`Recibida pista de voz remota de peer ${targetUserId}`);
    if (event.streams[0]) {
      peers[targetUserId].remoteStream = event.streams[0];
      if (callbacksRef && callbacksRef.onRemoteStream) {
        callbacksRef.onRemoteStream(event.streams[0], targetUserId);
      }
    }
  };

  // Track connection states
  pc.onconnectionstatechange = () => {
    console.log(`Estado de enlace con ${targetUserId}: ${pc.connectionState}`);
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      removePeer(targetUserId);
    }
  };

  return peers[targetUserId];
}

/**
 * Stop and remove a peer connection
 */
function removePeer(peerId) {
  const peer = peers[peerId];
  if (peer) {
    try {
      peer.pc.close();
    } catch (e) {
      console.warn('Error al cerrar peer connection:', e);
    }
    
    // Stop their remote audio playback element
    if (callbacksRef && callbacksRef.onRemoteStreamRemoved) {
      callbacksRef.onRemoteStreamRemoved(peerId);
    }

    delete peers[peerId];
    console.log(`Conexión con peer ${peerId} removida.`);
  }
}

/**
 * Set PTT transmission state for all active peer connections in the mesh
 */
export function setLocalAudioTransmission(localStream, isTransmitting) {
  if (!localStream) return;

  localStream.getAudioTracks().forEach(track => {
    track.enabled = isTransmitting;
    console.log(`Micrófono local ${track.label}: ${isTransmitting ? 'TRANSMITIENDO' : 'MUTED (PTT)'}`);
  });
}

/**
 * Cleanup and terminate connection and channel subscriptions
 */
export async function closeConnection(roomId) {
  console.log('Cerrando todas las conexiones MESH y liberando canales...');

  // 1. Unsubscribe from Supabase realtime channels
  if (activeChannel) {
    supabase.removeChannel(activeChannel);
    activeChannel = null;
  }

  if (dbChannel) {
    supabase.removeChannel(dbChannel);
    dbChannel = null;
  }

  // 2. Close all active peer connections in the mesh
  Object.keys(peers).forEach(peerId => {
    removePeer(peerId);
  });
  
  peers = {};
  localStreamRef = null;
  callbacksRef = null;
}

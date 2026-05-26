import { supabase, updateRoomSignaling, sendIceCandidate, clearIceCandidates } from './supabase';

let pc = null;
let roomSubscription = null;
let candidatesSubscription = null;
let remoteVolumeAnalyser = null;
let remoteVolumeTimer = null;

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

/**
 * Get the current peer connection instance
 */
export function getPeerConnection() {
  return pc;
}

/**
 * Initialize WebRTC Peer Connection and set up signaling listeners using Supabase Realtime
 */
export async function startSignaling(
  roomId,
  userId,
  isHost,
  localStream,
  callbacks = {}
) {
  const {
    onRemoteStream,
    onConnectionState,
    onRemoteSpeaking, // fires with true/false based on speaking volume
    onRoomUpdate,
    onRoomDeleted,
    onError
  } = callbacks;

  try {
    console.log(`Iniciando señalización WebRTC como ${isHost ? 'Host' : 'Invitado'} para sala ${roomId}`);

    // Create RTCPeerConnection
    pc = new RTCPeerConnection(rtcConfig);

    // Add local stream tracks to WebRTC peer connection
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
      console.log('Tracks locales agregados al PeerConnection');
    }

    // Set up local ICE candidate gathering
    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        console.log('Nuevo candidato ICE generado localmente');
        try {
          await sendIceCandidate(roomId, userId, event.candidate.toJSON());
        } catch (err) {
          console.error('Error al enviar candidato ICE:', err);
        }
      }
    };

    // Listen to remote tracks
    pc.ontrack = (event) => {
      console.log('Track remoto recibido:', event.streams);
      if (onRemoteStream && event.streams[0]) {
        onRemoteStream(event.streams[0]);
        setupRemoteVolumeDetection(event.streams[0], onRemoteSpeaking);
      }
    };

    // Track state changes
    pc.onconnectionstatechange = () => {
      console.log('Cambio de estado de conexión WebRTC:', pc.connectionState);
      if (onConnectionState) {
        onConnectionState(pc.connectionState);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('Cambio de estado ICE:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        console.warn('Conexión perdida o fallida, reintentando...');
      }
    };

    // =========================================================================
    // 1. SIGNALLING VIA SUPABASE REALTIME (SDP OFFER / ANSWER)
    // =========================================================================
    
    // Subscribe to changes in the rooms table
    roomSubscription = supabase
      .channel(`room_signals_${roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        async (payload) => {
          if (payload.eventType === 'DELETE') {
            console.log('La sala ha sido eliminada de la base de datos.');
            if (onRoomDeleted) {
              await onRoomDeleted();
            }
            return;
          }

          const room = payload.new;
          console.log('Sala actualizada en base de datos:', room);

          if (onRoomUpdate) {
            await onRoomUpdate(room);
          }

          if (isHost) {
            // A. Host listens to guest joining and answers
            if (room.guest_id && !pc.localDescription) {
              console.log('Invitado detectado. Generando oferta SDP...');
              await createAndSendOffer(roomId);
            } else if (room.sdp_answer && pc.signalingState === 'have-local-offer') {
              console.log('Respuesta SDP recibida de invitado. Estableciendo descripción remota...');
              await pc.setRemoteDescription(new RTCSessionDescription(room.sdp_answer));
            }
          } else {
            // B. Guest listens to the offer
            if (room.sdp_offer && pc.signalingState === 'stable') {
              console.log('Oferta SDP recibida del Host. Estableciendo descripción remota...');
              await pc.setRemoteDescription(new RTCSessionDescription(room.sdp_offer));
              console.log('Generando respuesta SDP...');
              await createAndSendAnswer(roomId);
            }
          }
        }
      )
      .subscribe((status) => {
        console.log(`Estado de suscripción de sala: ${status}`);
        
        // If Guest joins, triggers checking if room already has offer
        if (!isHost && status === 'SUBSCRIBED') {
          checkExistingOffer(roomId);
        }
      });

    // =========================================================================
    // 2. SIGNALLING ICE CANDIDATES VIA SUPABASE
    // =========================================================================
    
    // Subscribe to ice_candidates insertions
    candidatesSubscription = supabase
      .channel(`ice_candidates_${roomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ice_candidates', filter: `room_id=eq.${roomId}` },
        async (payload) => {
          const candidateData = payload.new;
          // Only add candidates sent by the peer
          if (candidateData.sender_id !== userId) {
            console.log('Candidato ICE remoto recibido');
            try {
              if (pc.remoteDescription) {
                await pc.addIceCandidate(new RTCIceCandidate(candidateData.candidate));
              } else {
                // If remote description is not set yet, store it temporarily
                console.log('Guardando candidato ICE para cuando esté lista la descripción remota');
                if (!pc.pendingCandidates) pc.pendingCandidates = [];
                pc.pendingCandidates.push(candidateData.candidate);
              }
            } catch (err) {
              console.error('Error al agregar candidato ICE:', err);
            }
          }
        }
      )
      .subscribe();

    // If host, check if guest is already there (e.g. page refreshed)
    if (isHost) {
      const { data: room } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', roomId)
        .single();
      if (room && room.guest_id) {
        console.log('Invitado ya presente. Generando oferta inicial...');
        await createAndSendOffer(roomId);
      }
    }

  } catch (err) {
    console.error('Error al iniciar WebRTC:', err);
    if (onError) onError(err);
  }
}

/**
 * Sets up an AnalyserNode to detect if the remote user is actively speaking
 */
function setupRemoteVolumeDetection(stream, onRemoteSpeaking) {
  if (!onRemoteSpeaking) return;

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContextClass();
    const source = ctx.createMediaStreamSource(stream);
    
    remoteVolumeAnalyser = ctx.createAnalyser();
    remoteVolumeAnalyser.fftSize = 256;
    
    source.connect(remoteVolumeAnalyser);

    const bufferLength = remoteVolumeAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    let isSpeaking = false;
    
    const checkVolume = () => {
      if (!pc || pc.connectionState === 'closed') {
        ctx.close();
        return;
      }
      
      remoteVolumeAnalyser.getByteFrequencyData(dataArray);
      
      // Calculate average volume amplitude
      let total = 0;
      for (let i = 0; i < bufferLength; i++) {
        total += dataArray[i];
      }
      const average = total / bufferLength;

      // Speech threshold (~12 out of 255 represents audible signal)
      const speakingNow = average > 12;
      
      if (speakingNow !== isSpeaking) {
        isSpeaking = speakingNow;
        onRemoteSpeaking(isSpeaking);
      }
      
      remoteVolumeTimer = requestAnimationFrame(checkVolume);
    };
    
    checkVolume();
  } catch (err) {
    console.warn('No se pudo inicializar la detección de habla remota:', err);
  }
}

/**
 * Check if the host has already placed an offer (useful on join/reconnection)
 */
async function checkExistingOffer(roomId) {
  try {
    const { data: room } = await supabase
      .from('rooms')
      .select('sdp_offer')
      .eq('id', roomId)
      .single();
      
    if (room && room.sdp_offer && pc && pc.signalingState === 'stable') {
      console.log('Oferta existente encontrada al conectar. Configurando...');
      await pc.setRemoteDescription(new RTCSessionDescription(room.sdp_offer));
      await createAndSendAnswer(roomId);
    }
  } catch (err) {
    console.error('Error al verificar oferta existente:', err);
  }
}

/**
 * Creates SDP Offer and uploads it to Supabase
 */
async function createAndSendOffer(roomId) {
  if (!pc) return;
  try {
    const offer = await pc.createOffer({
      offerToReceiveAudio: true
    });
    await pc.setLocalDescription(offer);
    await updateRoomSignaling(roomId, 'sdp_offer', offer);
    console.log('Oferta SDP enviada con éxito.');
  } catch (err) {
    console.error('Error al crear oferta SDP:', err);
  }
}

/**
 * Creates SDP Answer and uploads it to Supabase
 */
async function createAndSendAnswer(roomId) {
  if (!pc) return;
  try {
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await updateRoomSignaling(roomId, 'sdp_answer', answer);
    console.log('Respuesta SDP enviada con éxito.');

    // Add any pending ICE candidates that were received prior to setting remote description
    if (pc.pendingCandidates && pc.pendingCandidates.length > 0) {
      console.log(`Agregando ${pc.pendingCandidates.length} candidatos ICE pendientes`);
      for (const cand of pc.pendingCandidates) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (err) {
          console.error('Error al agregar candidato pendiente:', err);
        }
      }
      pc.pendingCandidates = [];
    }
  } catch (err) {
    console.error('Error al crear respuesta SDP:', err);
  }
}

/**
 * Set transmission state of the mic. Mutes when PTT is released, unmutes when PTT is pressed.
 */
export function setLocalAudioTransmission(localStream, isTransmitting) {
  if (!localStream) return;
  
  localStream.getAudioTracks().forEach(track => {
    track.enabled = isTransmitting;
    console.log(`Pista de micrófono local ${track.label}: ${isTransmitting ? 'TRANSMITIENDO' : 'MUTED (PTT)'}`);
  });
}

/**
 * Cleanup and terminate connection and channel subscriptions
 */
export async function closeConnection(roomId) {
  console.log('Cerrando conexión WebRTC y limpiando recursos...');
  
  if (roomSubscription) {
    supabase.removeChannel(roomSubscription);
    roomSubscription = null;
  }
  
  if (candidatesSubscription) {
    supabase.removeChannel(candidatesSubscription);
    candidatesSubscription = null;
  }

  if (remoteVolumeTimer) {
    cancelAnimationFrame(remoteVolumeTimer);
    remoteVolumeTimer = null;
  }
  
  if (pc) {
    pc.close();
    pc = null;
  }

  if (roomId) {
    try {
      await clearIceCandidates(roomId);
    } catch (e) {
      console.log('Error al limpiar candidatos ICE en DB:', e);
    }
  }
}

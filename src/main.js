import { 
  supabase, 
  signUpUser, 
  signInUser, 
  signOutUser, 
  getCurrentUser, 
  getProfile, 
  getActiveRooms, 
  createRoom, 
  joinRoomAsGuest, 
  leaveRoom, 
  getFriendsList, 
  sendFriendRequest, 
  acceptFriendRequest 
} from './supabase';

import { 
  initMicrophone, 
  stopMicrophone, 
  playRemoteStream, 
  stopRemoteStream, 
  playGachaSound, 
  startRingtone, 
  stopRingtone 
} from './audio';

import { 
  startSignaling, 
  closeConnection, 
  setLocalAudioTransmission 
} from './webrtc';

// Global application states
let currentUser = null;
let currentProfile = null;
let activeRoom = null;
let isHostOfActiveRoom = false;
let localAudioStream = null;
let realtimeRoomsChannel = null;

// PTT and Swipe Gesture States
let startY = 0;
let isPttTransmitting = false;
let isLockHandsFreeMode = false;

// DOM Selectors
const authScreen = document.getElementById('auth-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const roomScreen = document.getElementById('room-screen');

// Auth DOM
const authForm = document.getElementById('auth-form');
const authTitle = document.getElementById('auth-title');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authUsernameField = document.getElementById('username-field-container');
const authUsernameInput = document.getElementById('auth-username');
const authEmailInput = document.getElementById('auth-email');
const authPasswordInput = document.getElementById('auth-password');
const authToggleMsg = document.getElementById('auth-toggle-msg');
const authToggleBtn = document.getElementById('auth-toggle-btn');

// Dashboard DOM
const userBadge = document.getElementById('user-badge');
const logoutBtn = document.getElementById('logout-btn');
const roomsContainer = document.getElementById('rooms-container');
const createRoomForm = document.getElementById('create-room-form');
const roomCodeInput = document.getElementById('room-code-input');
const roomTypeSelect = document.getElementById('room-type-select');
const roomPasswordContainer = document.getElementById('room-password-container');
const roomPasswordInput = document.getElementById('room-password-input');
const friendUsernameInput = document.getElementById('friend-username-input');
const addFriendForm = document.getElementById('add-friend-form');
const friendsContainer = document.getElementById('friends-container');

// Active Room DOM
const leaveRoomBtn = document.getElementById('leave-room-btn');
const activeRoomTitle = document.getElementById('active-room-title');
const callDuration = document.getElementById('call-duration');
const dendenMushiImg = document.getElementById('denden-mushi-img');
const dendenStatusBadge = document.getElementById('denden-status-badge');
const statusIndicatorDot = document.getElementById('status-indicator-dot');
const dendenStatusText = document.getElementById('denden-status-text');
const dendenInstructions = document.getElementById('denden-instructions');
const dendenGlowRing = document.getElementById('denden-glow-ring');
const dendenSpeakWaves = document.getElementById('denden-speak-waves');
const pttTriggerBtn = document.getElementById('ptt-trigger-btn');
const pttButtonLabel = document.getElementById('ptt-button-label');
const participantsList = document.getElementById('participants-list');

// Auth Mode
let isSignUpMode = false;

// ============================================================================
// 1. INITIALIZATION & AUTHENTICATION ROUTER
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initApp();
  registerServiceWorker();
});

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('PWA Service Worker registrado con éxito:', reg.scope))
      .catch(err => console.warn('Fallo al registrar PWA Service Worker:', err));
  }
}

async function initApp() {
  // Listen for Supabase Authentication State changes
  supabase.auth.onAuthStateChange(async (event, session) => {
    console.log('Cambio de estado de autenticación:', event);
    try {
      if (session && session.user) {
        currentUser = session.user;
        try {
          currentProfile = await getProfile(currentUser.id);
        } catch (err) {
          console.error('Error al cargar perfil tras login:', err);
          // Fallback profile if database trigger is slightly delayed or missing
          const fallbackUsername = currentUser.email ? currentUser.email.split('@')[0] : `User_${currentUser.id.slice(0, 5)}`;
          currentProfile = { username: fallbackUsername };
        }
        await setupDashboardView();
      } else {
        currentUser = null;
        currentProfile = null;
        setupAuthView();
      }
    } catch (authCycleError) {
      console.error('Error crítico en ciclo de autenticación:', authCycleError);
      alert('Error de inicialización de sesión: ' + (authCycleError.message || authCycleError));
      
      // Safety reset of the login submit button so it does not get stuck on 'Cargando...'
      const authSubmitBtn = document.getElementById('auth-submit-btn');
      if (authSubmitBtn) {
        authSubmitBtn.disabled = false;
        authSubmitBtn.innerText = isSignUpMode ? 'Registrarse' : 'Ingresar';
      }
    }
  });
}

// Router views switcher
function showScreen(screenId) {
  authScreen.classList.add('hidden');
  dashboardScreen.classList.add('hidden');
  roomScreen.classList.add('hidden');
  
  if (screenId === 'auth') authScreen.classList.remove('hidden');
  if (screenId === 'dashboard') dashboardScreen.classList.remove('hidden');
  if (screenId === 'room') roomScreen.classList.remove('hidden');
}

// Auth screen layout setup
function setupAuthView() {
  showScreen('auth');
  isSignUpMode = false;
  authTitle.innerText = 'Iniciar Sesión';
  authSubmitBtn.innerText = 'Ingresar';
  authUsernameField.classList.add('hidden');
  authUsernameInput.removeAttribute('required');
  authToggleMsg.innerText = '¿No tienes cuenta?';
  authToggleBtn.innerText = 'Crear Cuenta';
  authForm.reset();
}

// Toggle login vs signup
authToggleBtn.addEventListener('click', (e) => {
  e.preventDefault();
  isSignUpMode = !isSignUpMode;
  
  if (isSignUpMode) {
    authTitle.innerText = 'Crear Cuenta';
    authSubmitBtn.innerText = 'Registrarse';
    authUsernameField.classList.remove('hidden');
    authUsernameInput.setAttribute('required', 'required');
    authToggleMsg.innerText = '¿Ya tienes una cuenta?';
    authToggleBtn.innerText = 'Iniciar Sesión';
  } else {
    setupAuthView();
  }
});

// Handle Auth Form Submission
authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = authEmailInput.value;
  const password = authPasswordInput.value;
  
  try {
    authSubmitBtn.disabled = true;
    authSubmitBtn.innerText = 'Cargando...';
    
    if (isSignUpMode) {
      const username = authUsernameInput.value.trim();
      await signUpUser(email, password, username);
      alert('¡Cuenta creada exitosamente! Se ha iniciado sesión.');
    } else {
      await signInUser(email, password);
    }
  } catch (err) {
    console.error('Error de autenticación:', err);
    alert('Error: ' + (err.message || 'Credenciales inválidas.'));
    authSubmitBtn.disabled = false;
    authSubmitBtn.innerText = isSignUpMode ? 'Registrarse' : 'Ingresar';
  }
});

// Logout
logoutBtn.addEventListener('click', async () => {
  if (confirm('¿Deseas apagar el caracol y cerrar sesión?')) {
    await signOutUser();
  }
});


// ============================================================================
// 2. DASHBOARD VIEW (LIVE TABLÓN & SOCIAL SYSTEM)
// ============================================================================

async function setupDashboardView() {
  showScreen('dashboard');
  userBadge.innerText = currentProfile.username;
  
  // Load and update dashboard systems
  await updateRoomsList();
  await updateFriendsList();
  
  // Set up real-time automatic update for rooms listing using Supabase Realtime
  if (!realtimeRoomsChannel) {
    realtimeRoomsChannel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rooms' },
        async (payload) => {
          console.log('Actualización de salas en vivo en tiempo real:', payload.eventType);
          await updateRoomsList();
        }
      )
      .subscribe();
  }
}

// Show/hide password input when type changes
roomTypeSelect.addEventListener('change', () => {
  if (roomTypeSelect.value === 'password') {
    roomPasswordContainer.classList.remove('hidden');
    roomPasswordInput.setAttribute('required', 'required');
  } else {
    roomPasswordContainer.classList.add('hidden');
    roomPasswordInput.removeAttribute('required');
  }
});

// Create Room Form Submit
createRoomForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = roomCodeInput.value.toUpperCase().trim();
  const type = roomTypeSelect.value;
  const password = type === 'password' ? roomPasswordInput.value.trim() : null;
  
  try {
    const room = await createRoom(code, currentUser.id, type, password);
    createRoomForm.reset();
    roomPasswordContainer.classList.add('hidden');
    roomPasswordInput.removeAttribute('required');
    
    // Enter the created room as host
    await enterRoom(room, true);
  } catch (err) {
    console.error('Error al crear sala:', err);
    alert('Error al crear la sala: ' + (err.message || 'Código duplicado o inválido.'));
  }
});

// Fetch active rooms and render them dynamically
async function updateRoomsList() {
  try {
    const rooms = await getActiveRooms();
    
    if (rooms.length === 0) {
      roomsContainer.innerHTML = `
        <div class="flex flex-col items-center justify-center h-full text-slate-500 py-10 space-y-2">
          <span class="text-4xl">📭</span>
          <p class="text-xs font-medium">No hay caracoles activos en este momento.</p>
          <p class="text-[10px] text-slate-600">¡Crea tu propia sala para iniciar la llamada!</p>
        </div>
      `;
      return;
    }
    
    roomsContainer.innerHTML = rooms.map(room => {
      let privacyTag = '';
      if (room.room_type === 'password') privacyTag = '🔑 con contraseña';
      if (room.room_type === 'private') privacyTag = '🔒 privada';
      if (room.room_type === 'public') privacyTag = '🌐 pública';
      
      const isHost = room.host_id === currentUser.id;
      const isOccupied = room.guest_id !== null;
      
      return `
        <div class="glass-card rounded-2xl p-4 flex justify-between items-center border border-slate-800/80 hover:border-sky-500/30 transition duration-300">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <span class="font-extrabold text-white tracking-wide font-outfit">${room.room_code}</span>
              <span class="text-[9px] uppercase tracking-wider bg-slate-800 text-slate-400 px-2 py-0.5 rounded-md font-bold">${privacyTag}</span>
            </div>
            <p class="text-xs text-slate-400 font-inter">
              Host: <span class="text-slate-300 font-semibold">${room.host?.username || 'Desconocido'}</span> 
              ${isOccupied ? `• Copiloto: <span class="text-sky-400 font-semibold">${room.guest?.username || 'Conectado'}</span>` : '• [Esperando Copiloto]'}
            </p>
          </div>
          
          <div>
            ${isHost ? `
              <button onclick="window.handleDeleteRoom('${room.id}')" class="px-3.5 py-1.5 rounded-xl bg-rose-950/30 hover:bg-rose-900/60 border border-rose-900/40 text-rose-300 text-xs font-bold transition">
                Eliminar
              </button>
            ` : isOccupied ? `
              <button disabled class="px-3.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-600 text-xs font-bold cursor-not-allowed">
                Lleno
              </button>
            ` : `
              <button onclick="window.handleJoinRoom('${room.id}', '${room.room_type}', '${room.room_password || ''}')" class="px-4 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-xs font-bold transition shadow-md shadow-sky-500/10">
                Enlazar
              </button>
            `}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error al actualizar lista de salas:', err);
  }
}

// Global actions exposed on window for inline onclick handlers
window.handleDeleteRoom = async (roomId) => {
  if (confirm('¿Deseas cerrar permanentemente esta sala?')) {
    try {
      await leaveRoom(roomId, true);
      await updateRoomsList();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }
};

window.handleJoinRoom = async (roomId, type, serverPassword) => {
  if (type === 'password') {
    const passwordEntered = prompt('Esta sala requiere contraseña de enlace:');
    if (!passwordEntered) return;
    if (passwordEntered !== serverPassword) {
      alert('Contraseña de sala incorrecta. Acceso denegado.');
      return;
    }
  }
  
  try {
    const room = await joinRoomAsGuest(roomId, currentUser.id);
    await enterRoom(room, false);
  } catch (err) {
    alert('Error al ingresar a la sala: ' + err.message);
  }
};

// Social Friends System Form Submit
addFriendForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = friendUsernameInput.value.trim();
  
  try {
    // Find profile of targeted user by username
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', username)
      .maybeSingle();
      
    if (error || !profile) {
      alert(`El caracol usuario "${username}" no existe.`);
      return;
    }
    
    if (profile.id === currentUser.id) {
      alert('No puedes agregarte a ti mismo como amigo.');
      return;
    }
    
    await sendFriendRequest(currentUser.id, profile.id);
    alert(`Solicitud de amistad enviada a ${username}!`);
    friendUsernameInput.value = '';
    await updateFriendsList();
  } catch (err) {
    alert('Error al enviar solicitud: ' + (err.message || 'Ya existe una solicitud pendiente.'));
  }
});

// Update and render Friends list
async function updateFriendsList() {
  try {
    const friends = await getFriendsList(currentUser.id);
    
    if (friends.length === 0) {
      friendsContainer.innerHTML = `
        <div class="text-center py-8 text-slate-600 text-xs">
          Aún no tienes caracoles en tu libreta.
        </div>
      `;
      return;
    }
    
    friendsContainer.innerHTML = friends.map(friend => {
      const isPending = friend.status === 'pending';
      const isReceiver = !friend.isSender;
      
      return `
        <div class="glass-card rounded-xl p-3 flex justify-between items-center border border-slate-800/60 text-xs">
          <div>
            <p class="font-bold text-slate-200">👤 ${friend.username}</p>
            <p class="text-[10px] text-slate-500 uppercase tracking-wide font-medium mt-0.5">
              ${isPending ? (isReceiver ? 'Pendiente (Recibido)' : 'Pendiente (Enviado)') : 'Enlazado (Amigo)'}
            </p>
          </div>
          <div>
            ${isPending && isReceiver ? `
              <button onclick="window.handleAcceptFriend('${friend.relationshipId}')" class="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] transition">
                Aceptar
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error al actualizar libreta de amigos:', err);
  }
}

window.handleAcceptFriend = async (relationshipId) => {
  try {
    await acceptFriendRequest(relationshipId);
    await updateFriendsList();
  } catch (err) {
    alert('Error: ' + err.message);
  }
};


// ============================================================================
// 3. INTERCOM VOICE ROOM ACTIVE VIEW
// ============================================================================

async function enterRoom(room, isHost) {
  activeRoom = room;
  isHostOfActiveRoom = isHost;
  
  // Show Voice Call Screen
  showScreen('room');
  activeRoomTitle.innerText = `SALA: ${room.room_code}`;
  callDuration.innerText = 'Llamando...';
  
  // Reset PTT and Lock Handfree styles
  deactivatePTT();
  disableLockMode();
  
  // Connecting visual state
  updateMushiVisualState('sleeping');
  
  try {
    // 1. Play Calling ringtone loop (purupuru)
    startRingtone();
    
    // 2. Capture microphone and start motorcyclist noise audio filters
    dendenInstructions.innerText = 'Configurando cancelación de ruido y filtros de viento...';
    const { filteredStream } = await initMicrophone();
    localAudioStream = filteredStream;
    
    // Mute mic by default until PTT is pressed or Lock Mode is enabled
    setLocalAudioTransmission(localAudioStream, false);
    
    // 3. Start WebRTC signaling and listen to connection lifecycle
    dendenInstructions.innerText = 'Buscando enlace directo con copiloto...';
    
    await startSignaling(room.id, currentUser.id, isHost, localAudioStream, {
      onRemoteStream: (remoteStream) => {
        console.log('Stream remoto listo. Inicializando reproductor VoIP...');
        playRemoteStream(remoteStream);
      },
      onConnectionState: (state) => {
        handleWebRTCStateChange(state);
      },
      onRemoteSpeaking: (isSpeaking) => {
        handleRemoteUserSpeaking(isSpeaking);
      },
      onError: (err) => {
        console.error('Error WebRTC:', err);
        alert('Error en llamada WebRTC: ' + err.message);
      }
    });

    // Render active participants
    await updateParticipantsUI();
    
  } catch (err) {
    console.error('Fallo al ingresar a la sala:', err);
    alert('Error al iniciar los canales de audio: ' + err.message);
    await exitActiveRoom();
  }
}

// Track connection and toggle ringtones & visual states
function handleWebRTCStateChange(state) {
  if (state === 'connected') {
    // Stop Purupuru ringtone
    stopRingtone();
    callDuration.innerText = 'Conexión Establecida (VoIP)';
    dendenInstructions.innerText = 'Caracol de transmisión en línea. Mantén presionado🎙️ para hablar.';
    
    updateMushiVisualState('active');
    updateParticipantsUI();
  } else if (state === 'connecting') {
    callDuration.innerText = 'Conectando canales...';
    updateMushiVisualState('sleeping');
  } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
    callDuration.innerText = 'Sin Conexión';
    dendenInstructions.innerText = 'Reconectando con el caracol receptor...';
    stopRemoteStream();
    
    updateMushiVisualState('sleeping');
    startRingtone();
  }
}

// Handles when the remote user speaks (measured by AnalyserNode)
function handleRemoteUserSpeaking(isSpeaking) {
  if (isSpeaking) {
    updateMushiVisualState('talking');
    dendenStatusText.innerText = 'COPILOTO HABLANDO...';
    dendenStatusBadge.classList.replace('bg-slate-900', 'bg-sky-500/20');
    statusIndicatorDot.classList.replace('bg-slate-500', 'bg-sky-400');
    statusIndicatorDot.classList.add('animate-ping');
  } else {
    // If local user is transmitting, stay in transmitting visual state
    if (isPttTransmitting || isLockHandsFreeMode) {
      updateMushiVisualState('transmitting');
    } else {
      updateMushiVisualState('active');
      dendenStatusText.innerText = 'CARACOL EN ESPERA';
      dendenStatusBadge.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-bold font-inter text-slate-300';
      statusIndicatorDot.className = 'w-2 h-2 rounded-full bg-emerald-500';
    }
  }
}

// Render dynamic participants cards and friend requests
async function updateParticipantsUI() {
  try {
    // Re-fetch current room details to get host and guest usernames
    const { data: room } = await supabase
      .from('rooms')
      .select(`
        *,
        host:profiles!rooms_host_id_fkey(username),
        guest:profiles!rooms_guest_id_fkey(username)
      `)
      .eq('id', activeRoom.id)
      .single();

    if (!room) return;

    const hostName = room.host?.username || 'Piloto';
    const guestName = room.guest?.username || 'Copiloto...';
    
    // Check if we are friends with the other participant
    const peerId = (currentUser.id === room.host_id) ? room.guest_id : room.host_id;
    let isAlreadyFriend = false;
    let hasSentFriendRequest = false;

    if (peerId) {
      const friends = await getFriendsList(currentUser.id);
      const friendRecord = friends.find(f => f.friendId === peerId);
      if (friendRecord) {
        isAlreadyFriend = true;
        if (friendRecord.status === 'pending') {
          hasSentFriendRequest = true;
        }
      }
    }

    // Build participants elements HTML
    let guestHTML = '';
    if (room.guest_id) {
      const showFriendButton = !isAlreadyFriend && peerId;
      guestHTML = `
        <div class="flex justify-between items-center bg-slate-900/40 px-3.5 py-2.5 rounded-xl border border-slate-800/60">
          <div class="flex items-center gap-2">
            <span class="text-xs">👤</span>
            <span class="text-xs font-semibold text-slate-200">${guestName} (Copiloto)</span>
          </div>
          <div>
            ${showFriendButton ? `
              <button id="add-peer-friend-btn" onclick="window.handleAddPeerFriend('${peerId}')" class="px-2.5 py-1 bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-500 hover:to-sky-500 text-white text-[10px] font-black rounded-lg transition uppercase tracking-wider">
                + Amigo
              </button>
            ` : hasSentFriendRequest ? `
              <span class="text-[9px] uppercase font-bold tracking-wider text-slate-500">Solicitud Enviada</span>
            ` : `
              <span class="text-[9px] uppercase font-bold tracking-wider text-emerald-400">Enlazados</span>
            `}
          </div>
        </div>
      `;
    } else {
      guestHTML = `
        <div class="flex justify-center items-center bg-slate-900/20 px-3.5 py-3 rounded-xl border border-dashed border-slate-800/80 text-[10px] text-slate-500 uppercase tracking-widest font-black">
          Esperando Copiloto...
        </div>
      `;
    }

    participantsList.innerHTML = `
      <div class="flex justify-between items-center bg-slate-900/40 px-3.5 py-2.5 rounded-xl border border-slate-800/60">
        <div class="flex items-center gap-2">
          <span class="text-xs">👑</span>
          <span class="text-xs font-semibold text-slate-200">${hostName} (Piloto)</span>
        </div>
        <span class="text-[9px] uppercase font-bold tracking-wider text-indigo-400">Creador</span>
      </div>
      ${guestHTML}
    `;

  } catch (err) {
    console.error('Error al actualizar UI de participantes:', err);
  }
}

// Add friend from room action
window.handleAddPeerFriend = async (peerId) => {
  const btn = document.getElementById('add-peer-friend-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Enviando...';
  }
  
  try {
    await sendFriendRequest(currentUser.id, peerId);
    alert('¡Solicitud de amistad enviada!');
    await updateParticipantsUI();
    await updateFriendsList();
  } catch (err) {
    alert('Error al enviar solicitud: ' + err.message);
    if (btn) {
      btn.disabled = false;
      btn.innerText = '+ Amigo';
    }
  }
};

// Switch Den Den Mushi image states
function updateMushiVisualState(state) {
  // Remove talking animations
  dendenMushiImg.classList.remove('denden-talking');
  dendenSpeakWaves.classList.add('hidden');
  dendenGlowRing.className = 'absolute w-64 h-64 rounded-full bg-sky-500/5 border border-sky-500/20 blur-xl transition-all duration-500';

  if (state === 'sleeping') {
    dendenMushiImg.src = '/images/dendenmushi/denden_dormido.png';
    dendenStatusText.innerText = 'LLAMANDO A CANALES...';
    dendenStatusBadge.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-bold font-inter text-slate-400';
    statusIndicatorDot.className = 'w-2 h-2 rounded-full bg-amber-500 animate-pulse';
  } 
  else if (state === 'active') {
    dendenMushiImg.src = '/images/dendenmushi/denden_activo.png';
    dendenStatusText.innerText = 'CONECTADO - CARACOL ACTIVO';
    dendenStatusBadge.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-bold font-inter text-slate-300';
    statusIndicatorDot.className = 'w-2 h-2 rounded-full bg-emerald-500';
  } 
  else if (state === 'transmitting') {
    dendenMushiImg.src = '/images/dendenmushi/denden_activo.png';
    dendenStatusText.innerText = 'TRANSMITIENDO AUDIO VOIP';
    dendenStatusBadge.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-xs font-bold font-inter text-emerald-300';
    statusIndicatorDot.className = 'w-2 h-2 rounded-full bg-emerald-400 ptt-active';
    dendenGlowRing.classList.add('bg-glow-teal');
  } 
  else if (state === 'talking') {
    dendenMushiImg.src = '/images/dendenmushi/denden_hablando.png';
    dendenMushiImg.classList.add('denden-talking');
    dendenSpeakWaves.classList.remove('hidden');
    dendenGlowRing.classList.add('bg-glow-teal');
  }
}


// ============================================================================
// 4. PRESS-TO-TALK & SWIPE UP LOCK GESTURE ENGINE
// ============================================================================

// Toggle micro transmission on PTT active
function activatePTT() {
  if (isLockHandsFreeMode) return;
  
  isPttTransmitting = true;
  setLocalAudioTransmission(localAudioStream, true);
  updateMushiVisualState('transmitting');
  
  pttTriggerBtn.className = 'w-28 h-28 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 border border-emerald-400/50 flex flex-col items-center justify-center shadow-2xl scale-95 transition-all duration-150 ptt-active cursor-pointer touch-none z-20';
  pttButtonLabel.innerText = 'HABLANDO';
  pttButtonLabel.className = 'text-[9px] font-black text-white tracking-wider uppercase mt-1';
  dendenInstructions.innerText = 'Tu micrófono está abierto. Los demás copilotos te escuchan.';
}

function deactivatePTT() {
  if (isLockHandsFreeMode) return;
  
  isPttTransmitting = false;
  setLocalAudioTransmission(localAudioStream, false);
  updateMushiVisualState('active');
  
  pttTriggerBtn.className = 'w-28 h-28 rounded-full bg-gradient-to-tr from-slate-800 to-slate-950 border border-slate-700/60 flex flex-col items-center justify-center shadow-2xl active:scale-95 transition-all duration-150 cursor-pointer touch-none z-20';
  pttButtonLabel.innerText = 'PRESIONAR';
  pttButtonLabel.className = 'text-[9px] font-black text-slate-400 tracking-wider uppercase mt-1';
  dendenInstructions.innerText = 'Caracol de transmisión en línea. Mantén presionado🎙️ para hablar.';
}

// Activate continuous Hands-Free Lock Mode
function activateLockMode() {
  isLockHandsFreeMode = true;
  isPttTransmitting = false;
  
  // Play the gacha sound effect
  playGachaSound();
  
  // Force transmission open continuously
  setLocalAudioTransmission(localAudioStream, true);
  
  // Visual state to gold/amber glow
  dendenMushiImg.src = '/images/dendenmushi/denden_activo.png';
  dendenStatusText.innerText = 'MODO LOCK: MANOS LIBRES';
  dendenStatusBadge.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 text-xs font-bold font-inter text-amber-300';
  statusIndicatorDot.className = 'w-2 h-2 rounded-full bg-amber-400 ptt-active';
  
  dendenGlowRing.className = 'absolute w-64 h-64 rounded-full bg-amber-500/5 border border-amber-500/20 blur-xl transition-all duration-500 bg-glow-amber';
  
  pttTriggerBtn.className = 'w-28 h-28 rounded-full bg-gradient-to-tr from-amber-500 to-yellow-400 border border-yellow-300/50 flex flex-col items-center justify-center shadow-2xl ptt-active cursor-pointer touch-none z-20';
  pttButtonLabel.innerText = 'LOCK ACTIVO';
  pttButtonLabel.className = 'text-[9px] font-black text-slate-950 tracking-wider uppercase mt-1';
  dendenInstructions.innerText = 'Micrófono BLOQUEADO ABIERTO. Presiona de nuevo para silenciar.';
}

function disableLockMode() {
  isLockHandsFreeMode = false;
  deactivatePTT();
}

// Attach gesture listeners using pointer events for mobile responsive touch down/up & swipe
pttTriggerBtn.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  pttTriggerBtn.setPointerCapture(event.pointerId);
  startY = event.clientY;
  
  if (isLockHandsFreeMode) {
    // Tapping while in lock mode disables it
    disableLockMode();
    startY = 0;
    return;
  }
  
  activatePTT();
});

pttTriggerBtn.addEventListener('pointermove', (event) => {
  event.preventDefault();
  if (startY > 0 && !isLockHandsFreeMode) {
    const currentY = event.clientY;
    const diffY = startY - currentY;
    
    // Swipe up threshold: 50px
    if (diffY > 50) {
      activateLockMode();
      startY = 0; // reset to avoid multiple triggers
    }
  }
});

pttTriggerBtn.addEventListener('pointerup', (event) => {
  event.preventDefault();
  pttTriggerBtn.releasePointerCapture(event.pointerId);
  startY = 0;
  if (!isLockHandsFreeMode) {
    deactivatePTT();
  }
});

pttTriggerBtn.addEventListener('pointercancel', (event) => {
  event.preventDefault();
  startY = 0;
  if (!isLockHandsFreeMode) {
    deactivatePTT();
  }
});


// ============================================================================
// 5. TEARDOWN & EXIT SYSTEM
// ============================================================================

async function exitActiveRoom() {
  if (!activeRoom) return;
  
  const roomId = activeRoom.id;
  const wasHost = isHostOfActiveRoom;
  
  // Loading indicators
  callDuration.innerText = 'Desconectando...';
  
  try {
    // 1. Terminate audio context, voice feeds and ringtone
    stopRingtone();
    stopRemoteStream();
    stopMicrophone();
    
    // 2. Shut down WebRTC signals and delete ice records
    await closeConnection(roomId);
    
    // 3. Clear profile status in the database room record
    await leaveRoom(roomId, wasHost);
    
  } catch (err) {
    console.warn('Error durante cierre y salida:', err);
  } finally {
    // Reset global references
    activeRoom = null;
    isHostOfActiveRoom = false;
    localAudioStream = null;
    
    // Return back to dashboard view
    setupDashboardView();
  }
}

leaveRoomBtn.addEventListener('click', async () => {
  if (confirm('¿Deseas desconectar el enlace del caracol y salir de la sala?')) {
    await exitActiveRoom();
  }
});

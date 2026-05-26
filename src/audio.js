/**
 * Audio control and Web Audio API helmet filter system for Den Den Mushi Intercom
 */

let audioCtx = null;
let micStream = null;
let filteredMicStream = null;
let ringtoneAudio = null;
let currentMicSource = null;
let helmetHighPass = null;
let helmetBandPass = null;

// Audio elements for sound effects are disabled

/**
 * Initialize the Web Audio Context after user interaction to satisfy browser security policies
 */
export function getAudioContext() {
  if (!audioCtx) {
    // Create AudioContext with fallback for standard and webkit browsers
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass({
      latencyHint: 'interactive'
    });
    console.log('Web Audio Context inicializado:', audioCtx.state);
  }
  
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Capture microphone with native browser noise/echo filters and build the Motorcycle Helmet filter chain
 */
export async function initMicrophone() {
  if (micStream) return { rawStream: micStream, filteredStream: filteredMicStream };

  try {
    const ctx = getAudioContext();

    // 1. Capture microphone with native filters enabled to combat wind noise
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1, // Mono is better for communication and saves bandwidth
        sampleRate: 16000 // Voice-optimized sample rate
      }
    });

    console.log('Micrófono capturado con filtros nativos.');

    // 2. Build the Web Audio API pipeline for the Motorcycle/Helmet environment
    currentMicSource = ctx.createMediaStreamSource(micStream);

    // Filter A: High-pass filter at 200Hz to eliminate low-frequency rumble (engine and exhaust vibration)
    helmetHighPass = ctx.createBiquadFilter();
    helmetHighPass.type = 'highpass';
    helmetHighPass.frequency.value = 200; // Cut off frequencies below 200Hz

    // Filter B: Bandpass filter centered at 1500Hz with a Q factor of 0.8
    // This isolates the critical human speech intelligibility frequency band (300Hz - 3000Hz)
    helmetBandPass = ctx.createBiquadFilter();
    helmetBandPass.type = 'bandpass';
    helmetBandPass.frequency.value = 1500;
    helmetBandPass.Q.value = 0.8;

    // Filter C: Dynamic Gain Node to control local gain prior to transmission
    const transmitGain = ctx.createGain();
    transmitGain.gain.value = 1.2; // Slightly boost speech signal

    // Connect nodes: Source -> Highpass -> Bandpass -> Gain
    currentMicSource.connect(helmetHighPass);
    helmetHighPass.connect(helmetBandPass);
    helmetBandPass.connect(transmitGain);

    // 3. Output to a low-priority VoIP destination node
    // Using createMediaStreamDestination creates a mixed destination stream that WebRTC can transmit
    const destination = ctx.createMediaStreamDestination();
    transmitGain.connect(destination);
    filteredMicStream = destination.stream;

    console.log('Filtro de casco de moto activado: Highpass 200Hz + Bandpass 1500Hz.');
    return { rawStream: micStream, filteredStream: filteredMicStream };
  } catch (err) {
    console.error('Error al inicializar micrófono con filtros:', err);
    throw err;
  }
}

/**
 * Disables the microphone input and cleans up nodes
 */
export function stopMicrophone() {
  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }
  if (currentMicSource) {
    currentMicSource.disconnect();
    currentMicSource = null;
  }
  filteredMicStream = null;
  console.log('Micrófono y filtros detenidos.');
}

/**
 * Plays the incoming WebRTC voice stream inside a hidden HTML5 Audio Element.
 * Routes through the Web Audio graph to a low-priority VoIP node, which ensures
 * iOS and Android mix the audio with background music (Spotify/YouTube) instead of pausing.
 */
export function playRemoteStream(remoteStream, peerId = 'default') {
  try {
    const ctx = getAudioContext();
    const elementId = `webrtc-remote-audio-${peerId}`;
    
    // Create an HTML5 Audio element for background playback
    let audioElement = document.getElementById(elementId);
    if (!audioElement) {
      audioElement = document.createElement('audio');
      audioElement.id = elementId;
      audioElement.style.display = 'none';
      audioElement.autoplay = true;
      audioElement.controls = false;
      
      // CRITICAL: playsinline & none metadata ensures mobile OS doesn't request exclusive focus
      audioElement.setAttribute('playsinline', '');
      audioElement.setAttribute('webkit-playsinline', '');
      
      document.body.appendChild(audioElement);
    }

    // Set the stream source
    audioElement.srcObject = remoteStream;

    // Connect remote stream to the Web Audio output graph for smooth mixing with system apps
    const remoteSource = ctx.createMediaStreamSource(remoteStream);
    
    // Create a compressor to level out speech volume spikes while riding
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-24, ctx.currentTime);
    compressor.knee.setValueAtTime(30, ctx.currentTime);
    compressor.ratio.setValueAtTime(12, ctx.currentTime);
    compressor.attack.setValueAtTime(0.003, ctx.currentTime);
    compressor.release.setValueAtTime(0.25, ctx.currentTime);

    // Main output volume gain
    const outGain = ctx.createGain();
    outGain.gain.value = 1.0;

    remoteSource.connect(compressor);
    compressor.connect(outGain);
    outGain.connect(ctx.destination);

    // Audio element plays in parallel to maintain connection, but we keep volume low or rely on the Web Audio context
    audioElement.volume = 0.01; 
    audioElement.play().catch(e => {
      console.warn('Autoplay bloqueado en el elemento de audio, sonará a través del AudioContext:', e);
    });

    console.log(`Flujo de audio remoto para ${peerId} conectado exitosamente.`);
  } catch (err) {
    console.error('Error al reproducir stream de audio remoto:', err);
  }
}

/**
 * Stop remote stream playback
 */
export function stopRemoteStream(peerId) {
  if (peerId) {
    const elementId = `webrtc-remote-audio-${peerId}`;
    const audioElement = document.getElementById(elementId);
    if (audioElement) {
      audioElement.srcObject = null;
      audioElement.pause();
      audioElement.remove();
    }
    console.log(`Audio remoto de WebRTC para peer ${peerId} detenido.`);
  } else {
    // Select all audio elements starting with webrtc-remote-audio-
    const elements = document.querySelectorAll('audio[id^="webrtc-remote-audio-"]');
    elements.forEach(audioElement => {
      audioElement.srcObject = null;
      audioElement.pause();
      audioElement.remove();
    });
    console.log('Todos los flujos de audio remoto de WebRTC detenidos.');
  }
}

/**
 * Sound FX: Play the Swipe-Up Gacha sound (Disabled)
 */
export function playGachaSound() {
  // Disabled as requested
}

/**
 * Sound FX: Play the Den Den Mushi calling tone (purupuru.mp3) (Disabled)
 */
export function startRingtone() {
  // Disabled as requested
}

/**
 * Sound FX: Stop the Den Den Mushi calling tone (Disabled)
 */
export function stopRingtone() {
  // Disabled as requested
}

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase environment variables are missing! Make sure to set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false // Disable session persistence to log out on page reload/tab close
  }
});

/**
 * Authentication Helpers
 */
export async function signUpUser(email, password, username) {
  if (username.length < 3) {
    throw new Error('El nombre de usuario debe tener al menos 3 caracteres.');
  }
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        username: username
      }
    }
  });
  if (error) throw error;
  return data;
}

export async function signInUser(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  if (error) throw error;
  return data;
}

export async function signOutUser() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Rooms Helpers
 */
export async function getActiveRooms() {
  const { data, error } = await supabase
    .from('rooms')
    .select(`
      *,
      host:profiles!rooms_host_id_fkey(username),
      guest:profiles!rooms_guest_id_fkey(username)
    `)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createRoom(roomCode, hostId, roomType = 'public', password = null) {
  const { data, error } = await supabase
    .from('rooms')
    .insert([
      {
        room_code: roomCode,
        host_id: hostId,
        room_type: roomType,
        room_password: password
      }
    ])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteRoom(roomId) {
  const { error } = await supabase
    .from('rooms')
    .delete()
    .eq('id', roomId);
  if (error) throw error;
}

export async function joinRoomAsGuest(roomId, guestId) {
  const { data, error } = await supabase
    .from('rooms')
    .update({ guest_id: guestId })
    .eq('id', roomId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function leaveRoom(roomId, userId) {
  // First, fetch current room status to know who is who
  const { data: room, error: fetchError } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .maybeSingle();

  if (fetchError || !room) {
    console.warn('No se pudo encontrar la sala al salir:', fetchError || 'Sala no existe');
    return null;
  }

  const isHost = room.host_id === userId;
  const isGuest = room.guest_id === userId;

  if (isHost) {
    if (room.guest_id) {
      // Host is leaving but there is a Guest: Promote Guest to Host
      console.log(`Promoviendo Copiloto ${room.guest_id} a Piloto de sala ${roomId}`);
      const { data, error } = await supabase
        .from('rooms')
        .update({ 
          host_id: room.guest_id, 
          guest_id: null, 
          sdp_offer: null, 
          sdp_answer: null 
        })
        .eq('id', roomId)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      // Host is leaving and no Guest: Delete the room entirely
      console.log(`El Piloto sale de sala ${roomId} vacía. Eliminando sala...`);
      return await deleteRoom(roomId);
    }
  } else if (isGuest) {
    // Guest is leaving: Clear guest_id and signaling
    console.log(`Copiloto ${userId} sale de sala ${roomId}. Limpiando señalización...`);
    const { data, error } = await supabase
      .from('rooms')
      .update({ 
        guest_id: null, 
        sdp_offer: null, 
        sdp_answer: null 
      })
      .eq('id', roomId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  
  return null;
}

export async function updateRoomSignaling(roomId, sdpField, sdpData) {
  const updateData = {};
  updateData[sdpField] = sdpData; // sdpField = 'sdp_offer' or 'sdp_answer'
  
  const { data, error } = await supabase
    .from('rooms')
    .update(updateData)
    .eq('id', roomId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Friends Helpers
 */
export async function getFriendsList(userId) {
  const { data, error } = await supabase
    .from('friends')
    .select(`
      id,
      user_id,
      friend_id,
      status,
      profiles!friends_user_id_fkey(id, username),
      friend_profile:profiles!friends_friend_id_fkey(id, username)
    `)
    .or(`user_id.eq.${userId},friend_id.eq.${userId}`);
  if (error) throw error;

  // Format array to show friend profiles directly with correct state
  return data.map(record => {
    const isSender = record.user_id === userId;
    const friendProfile = isSender ? record.friend_profile : record.profiles;
    return {
      relationshipId: record.id,
      friendId: friendProfile.id,
      username: friendProfile.username,
      status: record.status,
      isSender
    };
  });
}

export async function sendFriendRequest(userId, friendId) {
  const { data, error } = await supabase
    .from('friends')
    .insert([
      {
        user_id: userId,
        friend_id: friendId,
        status: 'pending'
      }
    ])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function acceptFriendRequest(relationshipId) {
  const { data, error } = await supabase
    .from('friends')
    .update({ status: 'accepted' })
    .eq('id', relationshipId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * ICE Candidates Helpers
 */
export async function sendIceCandidate(roomId, senderId, candidate) {
  const { data, error } = await supabase
    .from('ice_candidates')
    .insert([
      {
        room_id: roomId,
        sender_id: senderId,
        candidate: candidate
      }
    ])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function clearIceCandidates(roomId) {
  const { error } = await supabase
    .from('ice_candidates')
    .delete()
    .eq('room_id', roomId);
  if (error) throw error;
}

export function isAllowedRoom(roomId: string, allowedRoomIds: string[]): boolean {
  return allowedRoomIds.includes(roomId);
}

export function isAllowedUser(userId: string, allowedUserIds: string[]): boolean {
  return allowedUserIds.includes(userId);
}

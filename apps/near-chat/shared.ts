import { z } from 'zod';
export const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{2,23}$/);
export const profileSchema = z.object({ username: usernameSchema, displayName: z.string().trim().min(1).max(48) }).strict();
export interface Profile { id: string; username: string; displayName: string }
export interface Room { id: string; name: string; kind: 'direct' | 'group'; ownerId: string; updatedAt: string; unread: number; members: Profile[] }
export interface Message { id: string; roomId: string; senderId: string; body: string; sequence: number; createdAt: string; senderName: string }
export interface LinkedSession { id: string; name: string; createdAt: string; current: boolean }
export const roomSchema = z.object({ kind: z.enum(['direct', 'group']), name: z.string().trim().max(80).default(''), members: z.array(usernameSchema).min(1).max(29) }).strict();
export const messageSchema = z.object({ id: z.uuid(), body: z.string().trim().min(1).max(4000) }).strict();

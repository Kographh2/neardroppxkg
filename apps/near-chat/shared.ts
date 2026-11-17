import { z } from 'zod';
export const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{2,23}$/);
export const phoneSchema = z.string().regex(/^\+\d{6,15}$/);
export const profileSchema = z.object({ username: usernameSchema, displayName: z.string().trim().min(1).max(48), about: z.string().trim().max(140).optional(), avatar: z.string().max(1200000).nullable().optional(), readReceipts: z.boolean().optional() }).strict();
export interface Profile { id: string; username: string; displayName: string; phone?: string|null; avatar?: string|null; about?: string; readReceipts?: boolean }
export interface Contact { id: string; username: string; displayName: string; phone?: string|null; avatar?: string|null; about?: string; alias?: string }
export interface Room { id: string; name: string; kind: 'direct' | 'group'; ownerId: string; updatedAt: string; unread: number; members: Profile[] }
export interface Message { id: string; roomId: string; senderId: string; body: string; sequence: number; createdAt: string; senderName: string; kind?: 'text'|'image'|'call'; attachment?: string|null; replyTo?: string|null; forwarded?: boolean; deleted?: boolean; read?: boolean }
export interface StatusItem { id: string; userId: string; displayName: string; avatar?: string|null; kind: 'text'|'image'; body: string; caption?: string; bg?: string; createdAt: string; expiresAt: string; mine?: boolean }
export interface CallState { id: string; roomId: string; callerId: string; calleeId: string; kind: 'audio'; status: 'ringing'|'active'|'ended'|'declined'|'missed'; offer?: string|null; answer?: string|null; callerIce: string[]; calleeIce: string[]; createdAt: string; updatedAt: string }
export interface LinkedSession { id: string; name: string; createdAt: string; current: boolean }
export const roomSchema = z.object({ kind: z.enum(['direct', 'group']), name: z.string().trim().max(80).default(''), members: z.array(z.string().trim().min(1).max(32)).min(1).max(29) }).strict();
export const messageSchema = z.object({ id: z.uuid(), body: z.string().trim().max(4000).default(''), kind: z.enum(['text','image','call']).default('text'), attachment: z.string().max(5000000).nullable().optional(), replyTo: z.uuid().nullable().optional(), forwarded: z.boolean().optional() }).strict().refine(v=>v.kind==='image' ? !!v.attachment : v.body.length>0, {message:'Message cannot be empty.'});
export const contactSchema = z.object({ value: z.string().trim().min(1).max(32) }).strict();
export const statusSchema = z.object({ kind: z.enum(['text','image']).default('text'), body: z.string().trim().min(1).max(5000000), caption: z.string().trim().max(300).default(''), bg: z.string().trim().max(20).default('#177d69') }).strict();
export const callSchema = z.object({ roomId: z.uuid().optional(), action: z.enum(['start','offer','answer','ice','end','decline']), callId: z.uuid().optional(), payload: z.string().max(200000).optional() }).strict();
export const numberSchema = z.object({ country: z.string().trim().min(2).max(40).default('ID'), dial: z.string().trim().min(1).max(6).default('+62') }).strict();

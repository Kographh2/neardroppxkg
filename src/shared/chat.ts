import { z } from 'zod';
import { id, publicKeySchema } from './protocol';
export const chatEnvelopeSchema = z.object({
  id, receiverId: id, senderKey: publicKeySchema, receiverKey: publicKeySchema,
  iv: z.string().regex(/^[A-Za-z0-9+/]{16}$/),
  ciphertext: z.string().min(24).max(24000).regex(/^[A-Za-z0-9+/]+={0,2}$/)
}).strict();
export type ChatEnvelope = z.infer<typeof chatEnvelopeSchema>;
export type ChatMessage = ChatEnvelope & { senderId: string; createdAt: string };

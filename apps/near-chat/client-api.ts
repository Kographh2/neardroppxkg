export class ChatApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function chatApi<T>(path: string, data?: unknown, method?: string): Promise<T> {
  const response=await fetch(`/api/near-chat${path}`,{method:method||(data===undefined?'GET':'POST'),credentials:'same-origin',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(15000)});
  const result: unknown=await response.json().catch(()=>null);
  if(!response.ok)throw new ChatApiError(response.status,result&&typeof result==='object'&&'error' in result&&typeof result.error==='string'?result.error:'Could not reach NearChat. Try again.');
  return result as T;
}

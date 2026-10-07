import { api } from './api';
import type { ClientEvent, Device, ServerEvent } from '../shared/protocol';

interface EventPage { events: ServerEvent[]; cursor: number; devices: Device[] }
/** Reconnect starts a new session; interrupted files are explicitly retried. */
export class HttpSignaling {
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private connectionId?: string;
  private cursor = 0;
  private sends = Promise.resolve();
  constructor(private receive: (event: ServerEvent) => void, private failed: (error: unknown) => void) {}
  async connect() {
    const result=await api<{connectionId:string;cursor:number;ready:ServerEvent}>('/session/connect',{});
    if(this.stopped)return;
    this.connectionId=result.connectionId;this.cursor=result.cursor;this.receive(result.ready);
    void this.poll();
  }
  private async poll() {
    try {
      const page=await api<EventPage>(`/events?connectionId=${this.connectionId}&cursor=${this.cursor}`);
      if(this.stopped)return;
      // Presence must arrive before transfer events that require the peer key.
      this.receive({type:'devices',devices:page.devices});
      for(const event of page.events)this.receive(event);
      this.cursor=page.cursor;
      this.timer=setTimeout(()=>void this.poll(),page.events.length?100:750);
    } catch(error) { if(!this.stopped){this.close();this.failed(error);} }
  }
  send(event: ClientEvent) {
    const operation=this.sends.then(async()=>{
      if(this.stopped || !this.connectionId)throw new Error('The NearDrop connection ended.');
      await api('/events',{connectionId:this.connectionId,event});
    });
    this.sends=operation.catch(error=>{if(!this.stopped){this.close();this.failed(error);}});
    return operation;
  }
  close() {this.stopped=true;clearTimeout(this.timer);}
}

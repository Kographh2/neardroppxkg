'use client';
export default function ErrorPage({ reset }: { reset(): void }) { return <main id="main-content" className="large-empty"><h1>A small interruption.</h1><p>NearDrop couldn’t load this screen. Try again to reconnect.</p><button className="button primary" onClick={reset}>Try again</button></main>; }

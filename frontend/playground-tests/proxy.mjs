// Loopback-only test gateway using the same path split as the staging edge.
import {createServer, request} from "node:http";

createServer((incoming, outgoing) => {
  const port = incoming.url.startsWith("/playground/api/") ? 3392 : 3391;
  const upstream = request({hostname: "127.0.0.1", port, path: incoming.url,
    method: incoming.method, headers: incoming.headers}, response => {
    outgoing.writeHead(response.statusCode, response.headers);
    response.pipe(outgoing);
  });
  upstream.on("error", () => {outgoing.writeHead(502).end();});
  incoming.pipe(upstream);
}).listen(3390, "127.0.0.1");

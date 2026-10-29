// Loaded before every unit test file (vitest.config.mjs). The unit tests run without network: any connection they
// try, through net, http, fetch or WebSocket, or a UDP datagram, fails the test instead of reaching a host.
import { Socket as UdpSocket } from "node:dgram";
import { Socket } from "node:net";

const refuse = () => {
    throw new Error("The unit tests run without network");
};
Socket.prototype.connect = refuse;
UdpSocket.prototype.send = refuse;

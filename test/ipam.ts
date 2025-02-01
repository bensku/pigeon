import { CONNECTIONS } from './connections';
import * as ipam from '../src/ipam';
import * as host from '../src/host';

export async function pulumiProgram() {
  const host1 = new host.Host('host', {
    connection: CONNECTIONS[0],
  });
  const ipamHost = new ipam.IpamHost('ipam', {
    host: host1,
  });

  const network = new ipam.Network('net', {
    ipamHost,
    cidr: '10.0.1.0/24',
  });
  const ip1 = new ipam.IpAddress('ip1', { network });
  const ip2 = new ipam.IpAddress('ip2', { network });

  const testHost = new ipam.PortHost('ipam', {
    ipamHost,
    startPort: 30000,
    endPort: 30100,
  });
  const port1 = new ipam.PortAllocation('port1', {
    host: testHost,
  });
  const port2 = new ipam.PortAllocation('port2', {
    host: testHost,
  });

  return {
    network,
    ip1,
    ip2,
    testHost,
    port1,
    port2,
  };
}

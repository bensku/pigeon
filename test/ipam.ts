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

  return {
    network,
    ip1,
    ip2,
  };
}

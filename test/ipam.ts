import * as ipam from '../src/ipam';

export async function pulumiProgram() {
  const network = new ipam.Network('net', { prefix: '10.0.128.0/28' });
  const ip1 = new ipam.IpAddress('ip1', { network, portRange: [30000, 31000] });
  // const ip2 = new ipam.IpAddress('ip2', { network, portRange: [31000, 32000] });

  // const port1 = new ipam.PortAllocation('port1', { address: ip1 });
  // const port2 = new ipam.PortAllocation('port2', { address: ip1 });
  return {
    ip1: ip1.address,
    // ip2: ip2.address,
    // port1: port1.port,
    // port2: port2.port,
  };
}

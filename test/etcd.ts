import { CONNECTIONS } from './connections';
import * as host from '../src/host';
import * as flock from '../src/flock';
import * as etcd from '../src/etcd';

export async function pulumiProgram() {
  const host1 = new host.Host('host1', {
    connection: CONNECTIONS[0],
  });
  const host2 = new host.Host('host2', {
    connection: CONNECTIONS[1],
  });
  const host3 = new host.Host('host3', {
    connection: CONNECTIONS[2],
  });

  const net = new flock.Network('test-net', {
    epoch: 1,
    ipRange: '10.155.42.0/24',
    lighthouses: [
      { host: host1, underlayPort: 30000 },
      { host: host3, underlayPort: 30001 },
    ],
  });

  new etcd.EtcdCluster('test-etcd', {
    hosts: [host1, host2, host3],
    network: net,
    clientGroups: ['test-etcd'],
  });

  return {};
}

import { CONNECTIONS } from './connections';
import * as host from '../src/host';
import * as flock from '../src/flock';
import * as etcd from '../src/etcd';
import * as patroni from '../src/patroni';

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

  const etcdCluster = new etcd.Cluster('test-etcd', {
    hosts: [host1, host2, host3],
    network: net,
    clientGroups: ['postgres'],
  });

  new patroni.Cluster('test-patroni', {
    hosts: [host1, host2],
    network: net,
    etcd: etcdCluster,
    clientGroups: ['postgres-client'],
  });

  return {};
}

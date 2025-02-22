import { CONNECTIONS } from './connections';
import * as host from '../src/host';
import * as flock from '../src/flock';
import * as apt from '../src/apt';
import * as oci from '../src/oci';

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
    lighthouses: [host1, host3],
    underlayDnsSearchDomain: 'pigeonnnet',
  });

  const pod1 = new oci.Pod('pod', {
    host: host1,
    name: 'test-pod',
    networks: [
      {
        network: net,
        endpoint: {
          hostname: 'backend',
          groups: ['backend'],
          firewall: {
            inbound: [{ host: 'any', port: 8081 }],
            outbound: [],
          },
        },
      },
    ],
    ports: [[8081, 80]],
  });
  const backend = new oci.Container('container', {
    pod: pod1,
    name: 'backend',
    image: 'docker.io/nginx',
    environment: [
      ['TEST_VAR', 'test_str'],
      ['TEST_VAR2', 'test_str2'],
    ],
  });

  return {};
}

export async function testInfra() {}

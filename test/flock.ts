import { CONNECTIONS } from './connections';
import * as host from '../src/host';
import * as flock from '../src/flock';
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
    lighthouses: [
      { host: host1, underlayPort: 30000 },
      { host: host3, underlayPort: 30001 },
    ],
  });

  const pod1 = new oci.Pod('pod', {
    host: host1,
    name: 'test-pod',
    networks: [
      {
        network: net,
        config: {
          hostname: 'backend',
          groups: ['test-app'],
          firewall: {
            inbound: [{ host: 'any', port: 80 }],
            outbound: [],
          },
        },
      },
    ],
  });

  const backendConf = new oci.LocalFile('backend-conf', {
    pod: pod1,
    source: `server {
      location /test {
          add_header Content-Type text/plain;
          return 200 'success';
      }
  }`,
  });
  new oci.Container('backend', {
    pod: pod1,
    name: 'backend',
    image: 'docker.io/nginx',
    environment: [
      ['TEST_VAR', 'test_str'],
      ['TEST_VAR2', 'test_str2'],
    ],
    mounts: [[backendConf, '/etc/nginx/conf.d/default.conf']],
  });

  const pod2 = new oci.Pod('pod2', {
    host: host2,
    name: 'test-pod2',
    networks: [
      oci.HOST_NAT,
      {
        network: net,
        config: {
          hostname: 'proxy',
          groups: ['test-app'],
          firewall: {
            inbound: [],
            outbound: [{ host: 'backend', port: 80 }],
          },
        },
      },
    ],
    ports: [[8080, 80]],
  });

  const proxyConf = new oci.LocalFile('proxy-conf', {
    pod: pod2,
    source: `server {
    location /test {
        proxy_pass http://backend.pigeon.internal;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}`,
  });
  new oci.Container('proxy', {
    pod: pod2,
    name: 'proxy',
    image: 'docker.io/nginx',
    mounts: [[proxyConf, '/etc/nginx/conf.d/default.conf']],
  });

  return {};
}

export async function testInfra() {
  // Test that proxy is working and can reach backend
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const response = await fetch('http://test2:8080/test');
  if (response.status !== 200) {
    throw new Error(
      `Expected 200 OK but got ${response.status} ${response.statusText}`,
    );
  }
}

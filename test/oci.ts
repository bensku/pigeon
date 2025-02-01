import { CONNECTIONS } from './connections';
import * as host from '../src/host';
import * as apt from '../src/apt';
import * as oci from '../src/oci';

export async function pulumiProgram() {
  const host1 = new host.Host('host', {
    connection: CONNECTIONS[0],
  });
  const pod = new oci.Pod('pod', {
    host: host1,
    name: 'test-pod',
  });
  const volume = new oci.Volume('volume', {
    pod,
    name: 'test-volume',
  });
  const container = new oci.Container('container', {
    pod,
    name: 'test-container',
    image: 'docker.io/nginx',
    mounts: [[volume, '/test-volume']],
    environment: [['TEST_VAR', 'test_str']],
    ports: [[8081, 80]],
  });

  return {};
}

export async function testInfra() {
  // Test that our nginx container is running and working
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const response = await fetch('http://test1:8081');
  if (response.status !== 200) {
    throw new Error(
      `Expected 200 OK but got ${response.status} ${response.statusText}`,
    );
  }
}

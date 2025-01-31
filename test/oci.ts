import { CONNECTIONS } from './connections';
import * as host from '../src/host';
import * as apt from '../src/apt';
import * as oci from '../src/oci';

export async function pulumiProgram() {
  const host1 = new host.Host('host', {
    connection: CONNECTIONS[0],
  });
  // Install Podman, we'll need it
  const podman = new apt.Package('podman', {
    host: host1,
    name: 'podman',
  });
  const pod = new oci.Pod(
    'pod',
    {
      host: host1,
      name: 'test-pod',
    },
    { dependsOn: podman },
  );
  const volume = new oci.Volume('volume', {
    pod,
    name: 'test-volume',
  });
  const container = new oci.Container('container', {
    pod,
    name: 'test-container',
    image: 'alpine',
    mounts: [[volume, '/test-volume']],
    environment: [['TEST_VAR', 'test_str']],
  });

  return {};
}

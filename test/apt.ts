import { CONNECTIONS } from './connections';
import * as host from '../src/host';
import * as apt from '../src/apt';
import * as command from '@pulumi/command';

export async function pulumiProgram() {
  const host1 = new host.Host('host', {
    connection: CONNECTIONS[0],
  });
  const pkg = new apt.Package('podman', {
    host: host1,
    name: 'podman',
  });
  const podmanTest = new command.remote.Command(
    'test-podman',
    {
      connection: host1.connection,
      create: 'podman --version',
    },
    { dependsOn: pkg },
  );

  return {
    pkg,
    podmanVersion: podmanTest.stdout,
  };
}

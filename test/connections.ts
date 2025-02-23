import * as command from '@pulumi/command';
import * as fs from 'fs';

const privateKey = fs.readFileSync(
  process.env.TEST_SSH_KEY ?? process.env.HOME + '/.ssh/id_ed25519',
  'utf-8',
);

const hosts = new Map(
  fs
    .readFileSync('/etc/hosts', 'utf-8')
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    .map((line) => line.split(/\s+/))
    .filter((line) => line.length > 1)
    .map((line) => [line[1], line[0]]),
);
export const CONNECTIONS: command.remote.CommandArgs['connection'][] = [
  {
    host: hosts.get('test1')!,
    user: 'root',
    privateKey,
  },
  {
    host: hosts.get('test2')!,
    user: 'root',
  },
  {
    host: hosts.get('test3')!,
    user: 'root',
  },
];

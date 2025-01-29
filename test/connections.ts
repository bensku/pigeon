import * as command from '@pulumi/command';
import * as fs from 'fs';

const privateKey = fs.readFileSync(
  process.env.TEST_SSH_KEY ?? process.env.HOME + '/.ssh/id_ed25519',
  'utf-8',
);

export const CONNECTIONS: command.remote.CommandArgs['connection'][] = [
  {
    host: 'test1',
    user: 'root',
    privateKey,
  },
  {
    host: 'test2',
    user: 'root',
  },
  {
    host: 'test3',
    user: 'root',
  },
];

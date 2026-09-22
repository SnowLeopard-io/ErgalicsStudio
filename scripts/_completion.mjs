// Diagnostic: for every reaction, run the real engine at the default 900 K
// with DEFAULT_STEPS and report final progress + the frame when the last bond
// forms. Tells us whether a reaction "only reached an intermediate stage".
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { REACTIONS } from '../src/plugins/builtin/chem-reaction/catalog';
import { buildPhysicsPayload, DEFAULT_STEPS, DEFAULT_FRAMES } from '../src/plugins/builtin/chem-reaction/reactmd/payload';
const builds = [];
for (const def of REACTIONS) builds.push({ id: def.id, steps: DEFAULT_STEPS, frames: DEFAULT_FRAMES, payload: buildPhysicsPayload(def).payload });
const input = JSON.stringify(builds);
writeFileSync('scripts/_completion_input.json', input);
const out = execFileSync('python', ['scripts/_completion.py'], { input, encoding: 'utf8' });
console.log(out);
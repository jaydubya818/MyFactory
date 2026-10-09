// Trusted deterministic ExecutionProvider. Input is inert JSON; no generated code runs.
import { pathToFileURL } from 'node:url';
const { validatePackage, canonical } = await import(pathToFileURL(process.argv[2]).href);
let bytes = '';
for await (const chunk of process.stdin) { bytes += chunk; if (bytes.length > 100000) throw Error('APP_INPUT_BOUND'); }
process.stdout.write(canonical(validatePackage(JSON.parse(bytes))));

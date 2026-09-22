import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Utils from '../Utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const openapiPath = path.join(__dirname, '../public/openapi.json');
const indexJsPath = path.join(__dirname, '../index.js');
const packageJsonPath = path.join(__dirname, '../package.json');
const docxToPdfPath = path.join(__dirname, '../cloud/customRoute/docxtopdf.js');

describe('brand name is "Firma" instead of "FibexSign" in backend-emitted text', () => {
  it('exports appName as "Firma" from Utils.js', () => {
    expect(Utils.appName).toBe('Firma');
  });

  it('keeps serverAppId untouched as a functional Parse identifier', () => {
    expect(Utils.serverAppId).toBeDefined();
  });

  it('does not mention "FibexSign" in the openapi.json title or description', () => {
    const openapi = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
    expect(openapi.info.title).not.toContain('FibexSign');
    expect(openapi.info.description).not.toContain('FibexSign');
    const brandTag = openapi.tags.find(tag => tag.description === 'Electronic signature platform');
    expect(brandTag.name).not.toContain('FibexSign');
  });

  it('keeps the openapi.json contact email and server url untouched', () => {
    const openapi = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
    expect(openapi.info.contact.email).toBe('contacto@fibexsign.com');
    expect(openapi.servers[0].url).toBe('https://app.fibexsign.com/api/v1');
  });

  it('does not mention "FibexSign" in the index.js server startup messages', () => {
    const content = fs.readFileSync(indexJsPath, 'utf8');
    expect(content).not.toContain('fibexsign-server');
    expect(content).not.toMatch(/FibexSign/i);
  });

  it('does not mention "FibexSign" in the package.json description while keeping the repository url intact', () => {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    expect(packageJson.description).not.toMatch(/FibexSign/i);
    expect(packageJson.repository.url).toBe('https://github.com/GrupoConex/FibexSign');
  });

  it('does not mention "FibexSign" as a standalone product name in docxtopdf.js error messages while keeping soporte@fibexsign.com intact', () => {
    const content = fs.readFileSync(docxToPdfPath, 'utf8');
    expect(content).not.toMatch(/FibexSign(?!\.com)/i);
    expect(content).toContain('soporte@fibexsign.com');
  });
});

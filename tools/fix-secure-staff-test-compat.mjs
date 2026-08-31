import fs from 'node:fs';

const path = 'index.html';
let text = fs.readFileSync(path, 'utf8');

const oldText = `  document.querySelectorAll(".staff-manage-control").forEach(function(control) {
    control.disabled = busy || !isOrganizationAdmin();
  });
`;

const count = text.split(oldText).length - 1;
if (count !== 1) throw new Error(`Expected one staff control selector block, found ${count}`);
text = text.replace(oldText, '');
fs.writeFileSync(path, text);

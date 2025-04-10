// server.js

const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const cors = require('cors');
const os = require('os');

const app = express();
app.use(cors());
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 3000;

const PROJECT_DIR = path.join(__dirname, 'project');

async function cleanProjectDir() {
  try {
    if (fssync.existsSync(PROJECT_DIR)) {
      await fs.rm(PROJECT_DIR, { recursive: true, force: true });
    }
    await fs.mkdir(PROJECT_DIR);
  } catch (err) {
    console.error('Erro ao limpar diretório do projeto:', err);
  }
}

function installDependencies(targetDir) {
  try {
    if (fssync.existsSync(path.join(targetDir, 'package.json'))) {
      console.log('✅ package.json encontrado. Instalando dependências automaticamente...');
      execSync('npm install', { cwd: targetDir, stdio: 'inherit' });
    } else {
      console.log('⚠️ Nenhum package.json encontrado. Nenhuma dependência será instalada.');
    }
  } catch (err) {
    console.error('Erro ao instalar dependências:', err);
    throw new Error(`Falha ao instalar dependências: ${err.message}`);
  }
}

function runProject(res, sandboxDir, type, entryPoint) {
  const entryFile = path.join(sandboxDir, entryPoint);
  if (!fssync.existsSync(entryFile)) {
    fs.rm(sandboxDir, { recursive: true, force: true });
    return res.status(400).send('Ponto de entrada não encontrado.');
  }

  const args = type === 'module' ? ['--input-type=module', entryPoint] : [entryPoint];
  const child = spawn('node', args, { cwd: sandboxDir, timeout: 30000 });

  child.stdout.on('data', (data) => {
    res.write(data);
  });

  child.stderr.on('data', (data) => {
    res.write(`ERROR: ${data}`);
  });

  child.on('error', (err) => {
    res.write(`ERROR: ${err.message}`);
  });

  child.on('close', async (code) => {
    res.end(`\nProcesso finalizado com código ${code}`);
    await fs.rm(sandboxDir, { recursive: true, force: true });
  });
}

async function copyRecursiveAsync(src, dest) {
  const stat = await fs.stat(src);
  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src);
    for (const child of entries) {
      if (child === '.git') continue;
      await copyRecursiveAsync(path.join(src, child), path.join(dest, child));
    }
  } else if (stat.isFile()) {
    await fs.copyFile(src, dest);
  }
}

app.post('/execute', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('Nenhum arquivo enviado.');
  }

  try {
    await cleanProjectDir();

    const exnContent = await fs.readFile(req.file.path, 'utf8');
    if (!exnContent.trim()) {
      return res.status(400).send('Arquivo vazio.');
    }

    let exn;
    try {
      exn = JSON.parse(exnContent);
      if (typeof exn !== 'object' || Array.isArray(exn)) {
        return res.status(400).send('Estrutura de arquivo inválida.');
      }
      if (!exn.files || typeof exn.files !== 'object') {
        return res.status(400).send('Estrutura de arquivos inválida.');
      }
    } catch (err) {
      return res.status(400).send('Formato de arquivo inválido: ' + err.message);
    }

    const embeddedFiles = exn.files;

    for (const [filename, content] of Object.entries(embeddedFiles)) {
      const filePath = path.join(PROJECT_DIR, filename);
      const dirPath = path.dirname(filePath);
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(filePath, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
    }

    installDependencies(PROJECT_DIR);

    const sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-'));

    await copyRecursiveAsync(PROJECT_DIR, sandboxDir);

    let projectType = exn.metadata?.type || 'commonjs';
    let entryPoint = exn.metadata?.entryPoint || 'main.js';

    runProject(res, sandboxDir, projectType, entryPoint);

  } catch (err) {
    console.error(err);
    res.status(500).send(`Erro no processamento: ${err.message}`);
  } finally {
    await fs.unlink(req.file.path);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

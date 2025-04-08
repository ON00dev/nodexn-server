// server.js

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const app = express();
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 3000;

const PROJECT_DIR = path.join(__dirname, 'project');

// Limpa o diretório antes de cada upload
function cleanProjectDir() {
  if (fs.existsSync(PROJECT_DIR)) {
    fs.rmSync(PROJECT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(PROJECT_DIR);
}

// Instala dependências dinamicamente
function installDependencies(dependencies) {
  const deps = Object.entries(dependencies).map(([dep, version]) => `${dep}@${version}`).join(' ');
  if (deps.length > 0) {
    console.log('Instalando dependências:', deps);
    execSync(`npm install ${deps}`, { cwd: PROJECT_DIR, stdio: 'inherit' });
  }
}

// Executa o index.js extraído
function runProject(res) {
  const indexPath = path.join(PROJECT_DIR, 'index.js');
  if (!fs.existsSync(indexPath)) {
    return res.status(400).send('index.js não encontrado.');
  }

  const child = spawn('node', [indexPath], { cwd: PROJECT_DIR });

  child.stdout.on('data', (data) => {
    res.write(data);
  });

  child.stderr.on('data', (data) => {
    res.write(`ERROR: ${data}`);
  });

  child.on('close', (code) => {
    res.end(`\nProcesso finalizado com código ${code}`);
  });
}

// Endpoint para upload e execução do .exn
app.post('/execute', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('Nenhum arquivo enviado.');
  }

  try {
    cleanProjectDir();

    const exnContent = fs.readFileSync(req.file.path, 'utf8');
    const files = JSON.parse(exnContent);

    // Extrair arquivos
    for (const [filename, content] of Object.entries(files)) {
      const filePath = path.join(PROJECT_DIR, filename);
      const dirPath = path.dirname(filePath);
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
    }

    // Verificar e instalar dependências
    const packageJsonPath = path.join(PROJECT_DIR, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (packageJson.dependencies) {
        installDependencies(packageJson.dependencies);
      }
    }

    runProject(res);

  } catch (err) {
    console.error(err);
    res.status(500).send('Erro no processamento do arquivo.');
  } finally {
    fs.unlinkSync(req.file.path); // Remove o upload temporário
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

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
  const entryPoints = ['index.js', 'main.js'];
  let entryPoint = null;

  for (const point of entryPoints) {
    const filePath = path.join(PROJECT_DIR, point);
    if (fs.existsSync(filePath)) {
      entryPoint = point;
      break;
    }
  }

  if (!entryPoint) {
    return res.status(400).send('Nenhum ponto de entrada válido encontrado (index.js ou main.js).');
  }

  const child = spawn('node', [entryPoint], { cwd: PROJECT_DIR });

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

app.get('/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.write('<html><head><title>Logs</title></head><body>');
  res.write('<h1>Logs em Tempo Real</h1>');
  res.write('<pre id="log"></pre>');
  res.write(`<script>\n    const eventSource = new EventSource("/logs/stream");
    eventSource.onmessage = function(event) {
      document.getElementById("log").innerText += event.data + "\n";
    };
  </script>`);
  res.end('</body></html>');
});

app.get('/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const logMessage = (message) => {
    res.write(`data: ${message}\n\n`);
  };

  logMessage('Servidor iniciado');

  app.on('request', () => {
    logMessage('Nova requisição recebida');
  });

  app.on('execution', () => {
    logMessage('Execução iniciada');
  });

  app.on('close', () => {
    logMessage('Conexão encerrada');
  });
});

app.get('/', (req, res) => {
  res.redirect('/logs');
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

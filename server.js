const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

const SYSTEM_PROMPT = `Ты — micro helper, вдумчивый напарник небольшой продуктовой команды. Твоя задача — не звучать как энциклопедия, а помогать сдвинуть работу с места. Отвечай на языке вопроса. Сначала дай короткий честный вывод, затем 3–5 конкретных пунктов. Заканчивай одним выполнимым следующим шагом. Не выдумывай факты, отделяй допущения от известного и избегай канцелярита.`;

const MODE_PROMPTS = {
  decision: 'Помоги принять решение: обозначь варианты, критерии выбора и дай обоснованную рекомендацию.',
  meeting: 'Подготовь рабочую встречу: сформулируй цель, повестку с таймингом, вопросы и ожидаемый результат.',
  risks: 'Проведи спокойный pre-mortem: найди главные риски, оцени вероятность и предложи дешёвые проверки или меры.',
  writing: 'Собери ясный готовый текст без канцелярита. Сохрани смысл, укажи подходящий тон и не добавляй лишних фактов.'
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 30_000) reject(new Error('Запрос слишком большой'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function demoAnswer(question, messages = []) {
  const q = question.toLowerCase();
  if (messages.filter(message => message.role === 'user').length > 1) {
    if (q.includes('сократ') || q.includes('вдвое')) {
      return `## Да, это разумный ход\n\nСокращение объёма релиза вдвое снижает риск, если сохранить **один законченный пользовательский сценарий**, а не урезать все функции понемногу.\n\n- Оставьте ядро ценности, без которого релиз не имеет смысла\n- Перенесите улучшения и редкие сценарии в следующую итерацию\n- Зафиксируйте, что именно сознательно не входит в релиз\n- Проверьте сокращённый сценарий целиком перед запуском\n\n> Следующий шаг: разделите текущий scope на «обязательно», «можно позже» и «не сейчас», затем оставьте только первую колонку.`;
    }
    return `## Уточняю предыдущий ответ\n\nУчитывая контекст диалога, это стоит рассматривать как следующую итерацию решения, а не новую задачу.\n\n- Сохраните исходную цель\n- Измените только одно допущение за раз\n- Проверьте, как уточнение влияет на сроки и риски\n\n> Следующий шаг: сформулируйте, какое конкретно решение вы хотите изменить после этого уточнения.`;
  }
  if (q.includes('ретро') || q.includes('retro')) {
    return `## План ретро на 45 минут\n\n**Цель:** найти одно улучшение процесса, которое команда проверит уже в следующем спринте.\n\n- **5 мин** — чек-ин: каждый оценивает спринт от 1 до 5\n- **10 мин** — факты: что помогало и что мешало\n- **15 мин** — группировка тем и голосование\n- **10 мин** — разбор главной темы по методу «5 почему»\n- **5 мин** — назначить действие, владельца и дату проверки\n\n> Следующий шаг: заранее создайте доску с колонками «Сохранить», «Изменить», «Попробовать».`;
  }
  if (q.includes('метрик') || q.includes('kpi')) {
    return `## Рекомендация\n\nНачните с одной **целевой метрики** и 2–3 диагностических, чтобы команда видела результат и понимала его причины.\n\n- Целевая: доля пользователей, получивших ценность\n- Активация: завершение ключевого первого сценария\n- Удержание: возврат в продукт через 7 дней\n- Качество: доля ошибок или негативных оценок\n\n> Следующий шаг: сформулируйте событие, которое однозначно означает получение ценности пользователем.`;
  }
  if (q.includes('релиз') || q.includes('запуск')) {
    return `## Перед запуском\n\nСфокусируйтесь на обратимости релиза и быстром обнаружении проблем.\n\n- Зафиксируйте критерии успешного запуска\n- Проверьте аналитику ключевого сценария\n- Подготовьте feature flag или план отката\n- Назначьте ответственных на первые 24 часа\n- Согласуйте канал для обратной связи\n\n> Следующий шаг: проведите 15-минутный go/no-go созвон по этому чек-листу.`;
  }
  return `## Короткий вывод\n\nРазбейте задачу на проверяемые шаги и сначала снимите главное допущение — это даст команде быстрый сигнал без лишней работы.\n\n- Сформулируйте желаемый результат одним предложением\n- Назовите главное неизвестное или риск\n- Выберите самый дешёвый способ его проверить\n- Заранее определите критерий решения\n\n> Следующий шаг: запишите, какое решение вы примете при положительном и отрицательном результате проверки.\n\n_Демо-ответ сформирован локально. Для живых ответов задайте переменную \`GROQ_API_KEY\`._`;
}

async function handleAsk(req, res) {
  try {
    const raw = await readBody(req);
    const { messages = [], mode = 'decision', apiKey = '' } = JSON.parse(raw || '{}');
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
      return sendJson(res, 400, { error: 'История диалога пуста или слишком длинная.' });
    }
    const safeMessages = messages.map(message => ({
      role: message?.role === 'assistant' ? 'assistant' : 'user',
      content: typeof message?.content === 'string' ? message.content.trim() : ''
    }));
    if (safeMessages.some(message => !message.content || message.content.length > 4000)) {
      return sendJson(res, 400, { error: 'Одно из сообщений пустое или слишком длинное.' });
    }
    const question = [...safeMessages].reverse().find(message => message.role === 'user')?.content || '';
    if (question.length < 3) {
      return sendJson(res, 400, { error: 'Введите вопрос длиной не менее 3 символов.' });
    }
    if (typeof apiKey !== 'string' || apiKey.length > 300) {
      return sendJson(res, 400, { error: 'Некорректный API-ключ.' });
    }

    const modePrompt = MODE_PROMPTS[mode] || MODE_PROMPTS.decision;
    const activeApiKey = apiKey.trim() || process.env.GROQ_API_KEY;

    if (!activeApiKey) {
      await new Promise(resolve => setTimeout(resolve, 650));
      return sendJson(res, 200, { answer: demoAnswer(question, safeMessages), mode: 'demo' });
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${activeApiKey}`
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
        messages: [
          { role: 'system', content: `${SYSTEM_PROMPT}\n\nТекущий рабочий режим: ${modePrompt}` },
          ...safeMessages
        ],
        max_completion_tokens: 700,
        temperature: 0.4
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || 'Groq API вернул ошибку');
    const answer = data.choices?.[0]?.message?.content;
    if (!answer) throw new Error('Модель вернула пустой ответ');
    return sendJson(res, 200, { answer, mode: 'live' });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || 'Не удалось получить ответ.' });
  }
}

async function handleValidateKey(req, res) {
  try {
    const raw = await readBody(req);
    const { apiKey = '' } = JSON.parse(raw || '{}');
    if (typeof apiKey !== 'string' || apiKey.trim().length < 20 || apiKey.length > 300) {
      return sendJson(res, 400, { error: 'Проверьте формат ключа.' });
    }
    const response = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey.trim()}` }
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return sendJson(res, 401, { error: data?.error?.message || 'Groq не принял этот ключ.' });
    }
    return sendJson(res, 200, { ok: true });
  } catch {
    return sendJson(res, 500, { error: 'Не удалось проверить ключ. Попробуйте ещё раз.' });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/ask') return handleAsk(req, res);
  if (req.method === 'POST' && req.url === '/api/validate-key') return handleValidateKey(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });

  const urlPath = req.url.split('?')[0];
  const requested = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Forbidden' });

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') return sendJson(res, 404, { error: 'Not found' });
      return sendJson(res, 500, { error: 'Server error' });
    }
    res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' });
    if (req.method === 'HEAD') return res.end();
    res.end(content);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`micro helper: http://127.0.0.1:${PORT}`);
  console.log(process.env.GROQ_API_KEY ? 'Live Groq mode' : 'Demo mode (set GROQ_API_KEY for live AI)');
});

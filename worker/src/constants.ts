export const DAILY_LIMIT = 10;
export const TIMEZONE = 'America/Sao_Paulo';
export const CONTENT_PATH = 'src/content/news';

export const CATEGORY_WEIGHTS: Record<string, number> = {
  'ia-automacao': 4,
  'negocios-tech': 3,
  'startups': 2,
  'marketing-tech': 2,
  'tech-geral': 1,
};

export const IA_KEYWORDS = [
  'inteligência artificial', 'inteligencia artificial',
  'machine learning', 'aprendizado de máquina',
  'deep learning', 'aprendizado profundo',
  'ia generativa', 'generative ai', 'chatgpt',
  'gpt', 'llm', 'large language model',
  'automação', 'automacao', 'rpa',
  'robotic process', 'automation',
  'copilot', 'copiloto',
  'neural network', 'rede neural',
  'computer vision', 'visão computacional',
  'nlp', 'processamento linguagem natural',
  'assistente virtual', 'chatbot',
  'transformação digital', 'transformacao digital',
];

export const CATEGORY_LABELS: Record<string, string> = {
  'ia-automacao': 'IA & Automação',
  'negocios-tech': 'Negócios & Tech',
  'startups': 'Startups',
  'marketing-tech': 'Marketing & Tech',
  'tech-geral': 'Tech Geral',
};
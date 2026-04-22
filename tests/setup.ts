import { jest } from '@jest/globals';

// Test ortamında gerçek LLM API key'lerine ihtiyaç duyan
// constructor'ların başarısız olmaması için dummy key tanımla.
process.env.OPENAI_API_KEY = 'sk-test-openai-key';
process.env.ANTHROPIC_API_KEY = 'sk-test-anthropic-key';
process.env.GROQ_API_KEY = 'sk-test-groq-key';
process.env.MISTRAL_API_KEY = 'sk-test-mistral-key';
process.env.MINIMAX_API_KEY = 'sk-test-minimax-key';
process.env.NVIDIA_API_KEY = 'sk-test-nvidia-key';
process.env.GITHUB_TOKEN = 'ghp-test-github-token';

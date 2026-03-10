import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EmbeddingService, EmbeddingConfig } from '../src/services/EmbeddingService';
import { LoggingUtility } from '../src/utils/LoggingUtility';

declare global {
  var __requestUrlMock: ReturnType<typeof vi.fn>;
}

describe('EmbeddingService', () => {
  beforeEach(() => {
    // Reset global request mock
    global.__requestUrlMock.mockReset();

    // Reset LoggingUtility to avoid console noise during expected errors
    (LoggingUtility as any).initialized = false;
  });

  const defaultConfig: EmbeddingConfig = {
    endpoint: 'http://localhost:11434/api/embeddings',
    model: 'nomic-embed-text'
  };

  describe('generateEmbedding', () => {
    it('returns a single embedding successfully', async () => {
      global.__requestUrlMock.mockResolvedValue({
        status: 200,
        text: '',
        json: {
          data: [
            {
              embedding: [0.1, 0.2, 0.3],
              index: 0
            }
          ],
          model: 'nomic-embed-text',
          usage: { prompt_tokens: 10, total_tokens: 10 }
        }
      });

      const service = new EmbeddingService(defaultConfig);
      const embedding = await service.generateEmbedding('hello world');

      expect(embedding).toEqual([0.1, 0.2, 0.3]);
      expect(global.__requestUrlMock).toHaveBeenCalledTimes(1);

      const requestArgs = global.__requestUrlMock.mock.calls[0][0];
      expect(requestArgs.url).toBe(defaultConfig.endpoint);
      expect(requestArgs.method).toBe('POST');
      expect(requestArgs.headers['Content-Type']).toBe('application/json');
      expect(requestArgs.headers.Authorization).toBeUndefined();

      const body = JSON.parse(requestArgs.body);
      expect(body.input).toBe('hello world');
      expect(body.model).toBe(defaultConfig.model);
    });

    it('adds bearer authorization header when api key is configured', async () => {
      global.__requestUrlMock.mockResolvedValue({
        status: 200,
        text: '',
        json: {
          data: [{ embedding: [0.1], index: 0 }],
          model: 'nomic-embed-text',
          usage: { prompt_tokens: 1, total_tokens: 1 }
        }
      });

      const service = new EmbeddingService({
        ...defaultConfig,
        apiKey: 'secret-key'
      });

      await service.generateEmbedding('hello world');

      const requestArgs = global.__requestUrlMock.mock.calls[0][0];
      expect(requestArgs.headers.Authorization).toBe('Bearer secret-key');
    });

    it('ignores empty api key', async () => {
      global.__requestUrlMock.mockResolvedValue({
        status: 200,
        text: '',
        json: {
          data: [{ embedding: [0.1], index: 0 }],
          model: 'nomic-embed-text',
          usage: { prompt_tokens: 1, total_tokens: 1 }
        }
      });

      const service = new EmbeddingService({
        ...defaultConfig,
        apiKey: '   '
      });

      await service.generateEmbedding('hello world');

      const requestArgs = global.__requestUrlMock.mock.calls[0][0];
      expect(requestArgs.headers.Authorization).toBeUndefined();
    });

    it('throws error when response status is >= 400', async () => {
      global.__requestUrlMock.mockResolvedValue({
        status: 400,
        text: 'Bad Request',
        json: {}
      });

      const service = new EmbeddingService(defaultConfig);

      await expect(service.generateEmbedding('hello')).rejects.toThrow('Embedding API request failed: 400 - Bad Request');
    });

    it('throws error when data array is missing', async () => {
      global.__requestUrlMock.mockResolvedValue({
        status: 200,
        text: '',
        json: {} // missing data
      });

      const service = new EmbeddingService(defaultConfig);

      await expect(service.generateEmbedding('hello')).rejects.toThrow('No embedding data returned from API');
    });

    it('throws error when data array is empty', async () => {
      global.__requestUrlMock.mockResolvedValue({
        status: 200,
        text: '',
        json: { data: [] }
      });

      const service = new EmbeddingService(defaultConfig);

      await expect(service.generateEmbedding('hello')).rejects.toThrow('No embedding data returned from API');
    });
  });

  describe('generateEmbeddings', () => {
    it('returns multiple embeddings sorted by index successfully', async () => {
      global.__requestUrlMock.mockResolvedValue({
        status: 200,
        text: '',
        json: {
          data: [
            {
              embedding: [0.4, 0.5, 0.6],
              index: 1
            },
            {
              embedding: [0.1, 0.2, 0.3],
              index: 0
            }
          ],
          model: 'nomic-embed-text',
          usage: { prompt_tokens: 20, total_tokens: 20 }
        }
      });

      const service = new EmbeddingService(defaultConfig);
      const embeddings = await service.generateEmbeddings(['first', 'second']);

      expect(embeddings).toEqual([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6]
      ]);
      expect(global.__requestUrlMock).toHaveBeenCalledTimes(1);

      const requestArgs = global.__requestUrlMock.mock.calls[0][0];
      const body = JSON.parse(requestArgs.body);
      expect(body.input).toEqual(['first', 'second']);
    });

    it('throws error when response status is >= 400', async () => {
      global.__requestUrlMock.mockResolvedValue({
        status: 500,
        text: 'Internal Server Error',
        json: {}
      });

      const service = new EmbeddingService(defaultConfig);

      await expect(service.generateEmbeddings(['one', 'two'])).rejects.toThrow('Embedding API request failed: 500 - Internal Server Error');
    });

    it('throws error when data array is missing', async () => {
      global.__requestUrlMock.mockResolvedValue({
        status: 200,
        text: '',
        json: {} // missing data
      });

      const service = new EmbeddingService(defaultConfig);

      await expect(service.generateEmbeddings(['one', 'two'])).rejects.toThrow('No embedding data returned from API');
    });

    it('throws error when data array is empty', async () => {
      global.__requestUrlMock.mockResolvedValue({
        status: 200,
        text: '',
        json: { data: [] }
      });

      const service = new EmbeddingService(defaultConfig);

      await expect(service.generateEmbeddings(['one', 'two'])).rejects.toThrow('No embedding data returned from API');
    });
  });

  describe('testConnection', () => {
    it('returns success and dimensions on successful embedding', async () => {
      global.__requestUrlMock.mockResolvedValue({
        status: 200,
        text: '',
        json: {
          data: [
            {
              embedding: [0.5, 0.5],
              index: 0
            }
          ],
          model: 'nomic-embed-text',
          usage: { prompt_tokens: 1, total_tokens: 1 }
        }
      });

      const service = new EmbeddingService(defaultConfig);
      const result = await service.testConnection();

      expect(result).toEqual({ success: true, dimensions: 2 });
    });

    it('returns failure and error message on failed embedding', async () => {
      global.__requestUrlMock.mockResolvedValue({
        status: 401,
        text: 'Unauthorized',
        json: {}
      });

      const service = new EmbeddingService(defaultConfig);
      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Embedding API request failed: 401 - Unauthorized');
      expect(result.dimensions).toBeUndefined();
    });
  });

  describe('updateConfig', () => {
    it('updates configuration used for subsequent requests', async () => {
      global.__requestUrlMock.mockResolvedValue({
        status: 200,
        text: '',
        json: {
          data: [{ embedding: [1], index: 0 }],
          model: 'new-model',
          usage: { prompt_tokens: 1, total_tokens: 1 }
        }
      });

      const service = new EmbeddingService(defaultConfig);

      const newConfig: EmbeddingConfig = {
        endpoint: 'http://new-endpoint/api/embeddings',
        model: 'new-model',
        apiKey: 'new-key'
      };

      service.updateConfig(newConfig);

      await service.generateEmbedding('test');

      const requestArgs = global.__requestUrlMock.mock.calls[0][0];
      expect(requestArgs.url).toBe(newConfig.endpoint);
      expect(requestArgs.headers.Authorization).toBe('Bearer new-key');
      const body = JSON.parse(requestArgs.body);
      expect(body.model).toBe(newConfig.model);
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { LLMService } from '../src/services/LLMService';

declare global {
  var __requestUrlMock: ReturnType<typeof vi.fn>;
}

describe('LLMService request contract', () => {
  it('sends model when configured and returns assistant text', async () => {
    global.__requestUrlMock.mockResolvedValue({
      status: 200,
      headers: {},
      text: '',
      json: {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'ok'
            },
            finish_reason: 'stop'
          }
        ]
      }
    });

    const service = new LLMService({
      apiEndpoint: 'http://localhost:1234/v1/chat/completions',
      model: 'gemma-test'
    });

    const response = await service.sendMessage('hello');

    expect(response).toBe('ok');
    expect(global.__requestUrlMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(global.__requestUrlMock.mock.calls[0][0].body);
    expect(payload.model).toBe('gemma-test');
  });
});

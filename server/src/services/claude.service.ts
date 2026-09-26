import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env'
import { GitDiffResult, ImpactAnalysis } from '../types'
import { buildImpactAnalysisPrompt, buildTestCasePrompt } from '../utils/prompt.util'
import { saveImpactPayload, saveTestcasePayload } from '../utils/log-payload.util'
import { extractJsonFromLlmResponse } from '../utils/json-extract.util'
import { buildReportHeaderBeforeAiTc, buildReportFooter } from '../utils/markdown.util'
import { Response } from 'express'

export const CLAUDE_MODELS = [
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Haiku 4.5',
    inputPrice: 0.80,
    outputPrice: 4,
    description: '빠름 · 저렴',
    badge: '최저가',
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Sonnet 4.6',
    inputPrice: 3,
    outputPrice: 15,
    description: '품질 · 가격 균형',
    badge: '추천',
  },
  {
    id: 'claude-opus-4-6',
    name: 'Opus 4.6',
    inputPrice: 15,
    outputPrice: 75,
    description: '최고 품질',
    badge: '최고급',
  },
  {
    id: 'kt-ai-codi',
    name: 'KT AI Codi',
    inputPrice: 0,
    outputPrice: 0,
    description: 'KT Codi 앱 API',
    badge: 'KT',
  },
] as const

export type ClaudeModelId = (typeof CLAUDE_MODELS)[number]['id']

/** Anthropic API에 실제로 넘기는 Claude 모델 ID만 */
export type ClaudeAnthropicModelId = Exclude<ClaudeModelId, 'kt-ai-codi'>

export const DEFAULT_MODEL: ClaudeModelId = 'claude-haiku-4-5-20251001'

export class ClaudeService {
  private client: Anthropic | null = null

  /** Claude 전용 API 키가 있을 때만 클라이언트를 만듭니다 (Codi만 쓰는 경우 키 없음). */
  private getClient(): Anthropic {
    const key = env.ANTHROPIC_API_KEY?.trim()
    if (!key) {
      throw new Error('Claude 모델을 사용하려면 server/.env에 ANTHROPIC_API_KEY를 설정해 주세요.')
    }
    if (!this.client) this.client = new Anthropic({ apiKey: key })
    return this.client
  }

  async analyzeImpact(
    diff: GitDiffResult,
    model: ClaudeAnthropicModelId = 'claude-haiku-4-5-20251001',
    projectContextDocument?: string
  ): Promise<ImpactAnalysis> {
    const prompt = buildImpactAnalysisPrompt(diff, projectContextDocument)

    // 개발 환경에서만 payload 저장 (민감한 코드 노출 방지)
    if (env.NODE_ENV === 'development') {
      const logPath = await saveImpactPayload(diff, prompt, model)
      console.log('[Log] 영향도 분석 payload 저장:', logPath)
    }

    const message = await this.getClient().messages.create({
      model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    })

    const content = message.content[0]
    if (content.type !== 'text') {
      throw new Error('Claude API에서 예상치 못한 응답 형식을 반환했습니다')
    }

    try {
      console.log('[Claude] 영향도 분석 응답 수신, 길이:', content.text.length)
      const jsonStr = extractJsonFromLlmResponse(content.text)
      const result = JSON.parse(jsonStr) as ImpactAnalysis
      console.log('[Claude] 영향도 분석 파싱 성공:', { overallRisk: result.overallRisk, areas: result.affectedAreas?.length })
      return result
    } catch {
      console.warn('[Claude] 영향도 분석 파싱 실패, 기본값으로 대체. 원본 앞부분:', content.text.slice(0, 300))
      // 파싱 실패 시 에러를 던지지 않고 기본값 반환 (TC 생성은 계속 진행)
      return {
        overallRisk: 'medium',
        summary: content.text.slice(0, 500) || '영향도 분석 결과를 파싱할 수 없었습니다.',
        affectedAreas: [],
        recommendations: ['변경사항을 직접 확인하여 테스트 범위를 결정하세요.'],
      }
    }
  }

  /**
   * TC 생성: 보고서 상단(1~2절)은 고정 헤더로 먼저 보내고, 3절은 Claude 가 스트리밍으로 채운 뒤 푸터를 붙입니다.
   * (KT AI Codi 경로와 같은 보고서 모양)
   */
  async generateTestCasesStream(
    diff: GitDiffResult,
    analysis: ImpactAnalysis,
    res: Response,
    projectName?: string,
    model: ClaudeAnthropicModelId = 'claude-haiku-4-5-20251001',
    projectContextDocument?: string,
    compareSummary?: string
  ): Promise<void> {
    const prompt = buildTestCasePrompt(diff, analysis, projectName, projectContextDocument)

    // 개발 환경에서만 payload 저장 (민감한 코드 노출 방지)
    if (env.NODE_ENV === 'development') {
      const logPath = await saveTestcasePayload(diff, analysis, projectName, prompt, model)
      console.log('[Log] 테스트케이스 생성 payload 저장:', logPath)
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    const headerText = buildReportHeaderBeforeAiTc(diff, analysis, projectName, compareSummary ?? '')
    res.write(`data: ${JSON.stringify({ type: 'header', text: headerText })}\n\n`)

    // 테스트케이스 섹션을 비우지 말고 반드시 본문을 채우도록 시스템 지시
    const systemInstruction = `You are a QA engineer writing test cases in Markdown. Your response will be inserted directly under the heading "## 3. 테스트케이스" in a report. Do NOT write "## 3. 테스트케이스" again. Start your response immediately with "### TC-001:" and write at least 5 full test cases (### TC-001 through ### TC-005 or more). End with "## 테스트 실행 체크리스트" and list items. Never output an empty section or only a title.`

    try {
      const stream = await this.getClient().messages.stream({
        model,
        max_tokens: 8192,
        system: systemInstruction,
        messages: [{ role: 'user', content: prompt }],
      })

      for await (const chunk of stream) {
        // 클라이언트가 연결을 끊은 경우 스트리밍 중단
        if (res.socket?.destroyed) {
          stream.abort()
          return
        }
        if (
          chunk.type === 'content_block_delta' &&
          chunk.delta.type === 'text_delta'
        ) {
          const data = JSON.stringify({ type: 'delta', text: chunk.delta.text })
          res.write(`data: ${data}\n\n`)
        }
      }

      if (!res.socket?.destroyed) {
        res.write(`data: ${JSON.stringify({ type: 'delta', text: buildReportFooter() })}\n\n`)
        const finalMessage = await stream.finalMessage()
        const usage = finalMessage.usage
        res.write(
          `data: ${JSON.stringify({
            type: 'done',
            usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens },
          })}\n\n`
        )
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '알 수 없는 오류'
      res.write(`data: ${JSON.stringify({ type: 'error', error: errMsg })}\n\n`)
    } finally {
      res.end()
    }
  }
}

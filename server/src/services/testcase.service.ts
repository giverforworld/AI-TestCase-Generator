import { ClaudeService, ClaudeModelId, ClaudeAnthropicModelId, DEFAULT_MODEL } from './claude.service'
import { FileService } from './file.service'
import { GitDiffResult, ImpactAnalysis } from '../types'
import { buildReportHeader, buildReportFooter } from '../utils/markdown.util'
import { markdownToPdf } from '../utils/pdf.util'
import { Response } from 'express'

export class TestCaseService {
  private fileService: FileService
  private claudeService: ClaudeService

  constructor() {
    this.fileService = new FileService()
    this.claudeService = new ClaudeService()
  }

  async generateStream(
    diff: GitDiffResult,
    analysis: ImpactAnalysis,
    res: Response,
    projectName?: string,
    compareSummary?: string,
    model?: ClaudeModelId,
    projectContextDocument?: string
  ): Promise<void> {
    // 1단계 영향도 분석 결과를 근거로 Claude 가 "3. 테스트케이스" 를 스트리밍으로 작성한다.
    // (KT AI Codi 는 컨트롤러에서 별도 서비스로 분기되므로 여기 오는 모델은 Anthropic 모델뿐이다)
    const anthropicModel = (model && model !== 'kt-ai-codi' ? model : DEFAULT_MODEL) as ClaudeAnthropicModelId
    await this.claudeService.generateTestCasesStream(
      diff,
      analysis,
      res,
      projectName,
      anthropicModel,
      projectContextDocument,
      compareSummary
    )
  }

  async saveReport(
    tcContent: string,
    diff: GitDiffResult,
    analysis: ImpactAnalysis,
    projectName?: string,
    compareSummary?: string
  ): Promise<string> {
    const header = buildReportHeader(diff, analysis, projectName, compareSummary || '')
    const footer = buildReportFooter()
    const fullContent = header + tcContent + footer

    return this.fileService.saveMarkdown(fullContent, projectName)
  }

  async savePdfReport(
    tcContent: string,
    diff: GitDiffResult,
    analysis: ImpactAnalysis,
    projectName?: string,
    compareSummary?: string
  ): Promise<string> {
    const header = buildReportHeader(diff, analysis, projectName, compareSummary || '')
    const footer = buildReportFooter()
    const fullMarkdown = header + tcContent + footer

    const pdfBuffer = await markdownToPdf(fullMarkdown)
    return this.fileService.savePdf(pdfBuffer, projectName)
  }

  /**
   * 마크다운 전체 문자열을 PDF Buffer로만 변환해 반환. (파일 저장 없음)
   */
  async exportPdfBuffer(fullMarkdown: string): Promise<Buffer> {
    return markdownToPdf(fullMarkdown)
  }
}

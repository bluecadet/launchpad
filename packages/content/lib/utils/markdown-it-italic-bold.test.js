import { describe, it, expect } from 'vitest'
import MarkdownIt from 'markdown-it'
import italicBoldPlugin from './markdown-it-italic-bold.js'

describe('markdown-it-italic-bold plugin', () => {
  it('should convert * to <i> for italics', () => {
    const md = new MarkdownIt()
    md.use(italicBoldPlugin)
    const result = md.render('*italic*')
    expect(result.trim()).toBe('<p><i>italic</i></p>')
  })

  it('should convert _ to <i> for italics', () => {
    const md = new MarkdownIt()
    md.use(italicBoldPlugin)
    const result = md.render('_italic_')
    expect(result.trim()).toBe('<p><i>italic</i></p>')
  })

  it('should convert ** to <b> for bold', () => {
    const md = new MarkdownIt()
    md.use(italicBoldPlugin)
    const result = md.render('**bold**')
    expect(result.trim()).toBe('<p><b>bold</b></p>')
  })

  it('should convert __ to <b> for bold', () => {
    const md = new MarkdownIt()
    md.use(italicBoldPlugin)
    const result = md.render('__bold__')
    expect(result.trim()).toBe('<p><b>bold</b></p>')
  })

  it('should handle mixed italic and bold', () => {
    const md = new MarkdownIt()
    md.use(italicBoldPlugin)
    const result = md.render('*italic* and **bold**')
    expect(result.trim()).toBe('<p><i>italic</i> and <b>bold</b></p>')
  })

  it('should handle nested italic and bold', () => {
    const md = new MarkdownIt()
    md.use(italicBoldPlugin)
    const result = md.render('**bold *italic* text**')
    expect(result.trim()).toBe('<p><b>bold <i>italic</i> text</b></p>')
  })
})

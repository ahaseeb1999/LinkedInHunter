const ExcelJS = require('exceljs')
const path = require('path')
const os = require('os')
const { getSettings } = require('../database/db')

let app
try { app = require('electron').app } catch (_) { app = null }

function getExportPath() {
  const settings = getSettings()
  let base = settings.defaultExportPath
  if (!base) {
    base = app && app.getPath ? app.getPath('downloads') : path.join(os.homedir(), 'Downloads')
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return path.join(base, `LinkedIn_Hunt_${ts}.xlsx`)
}

const STATUS_COLORS = {
  'New':         { argb: 'FF2C2C3E' },
  'Applied':     { argb: 'FF1A4A7A' },
  'Interviewing':{ argb: 'FF0D5C3A' },
  'Rejected':    { argb: 'FF5C1A1A' },
  'Offer':       { argb: 'FF3A5C0D' },
}

const STATUS_FONT_COLORS = {
  'New':         { argb: 'FFAAAACC' },
  'Applied':     { argb: 'FF60AAFF' },
  'Interviewing':{ argb: 'FF00D4AA' },
  'Rejected':    { argb: 'FFFF6B6B' },
  'Offer':       { argb: 'FF90FF60' },
}

function styleHeader(row) {
  row.eachCell(cell => {
    cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0077B5' } }
    cell.font   = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' }
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF005080' } },
    }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false }
  })
  row.height = 28
}

function styleDataRow(row, isDuplicate, status, rowIdx) {
  const isEven = rowIdx % 2 === 0
  const baseBg = isEven ? 'FF13131F' : 'FF1A1A2E'
  const dupBg  = 'FF3D2B00'

  row.eachCell({ includeEmpty: true }, (cell, colNum) => {
    cell.fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: isDuplicate ? dupBg : baseBg },
    }
    cell.font = { color: { argb: isDuplicate ? 'FFFFB347' : 'FFD0D0E0' }, size: 10, name: 'Calibri' }
    cell.alignment = { vertical: 'middle', wrapText: colNum === 6 }
    cell.border = {
      bottom: { style: 'hair', color: { argb: 'FF2A2A3E' } },
    }
  })
  row.height = 22
}

async function exportToExcel({ jobs, posts }) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator    = 'LinkedIn Hunter'
  workbook.created    = new Date()
  workbook.properties = { date1904: false }

  // ─── JOBS SHEET ──────────────────────────────────────────────
  const jobSheet = workbook.addWorksheet('Jobs', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { tabColor: { argb: 'FF0077B5' } },
  })

  jobSheet.columns = [
    { header: '#',             key: 'num',         width: 5  },
    { header: 'Status',        key: 'status',      width: 14 },
    { header: 'Title',         key: 'title',       width: 36 },
    { header: 'Company',       key: 'company',     width: 24 },
    { header: 'Location',      key: 'location',    width: 20 },
    { header: 'Date Posted',   key: 'date_posted', width: 16 },
    { header: 'Job Type',      key: 'job_type',    width: 14 },
    { header: 'Apply Type',    key: 'apply_type',  width: 13 },
    { header: 'Applicants',    key: 'applicants',  width: 13 },
    { header: 'Salary',        key: 'salary',      width: 18 },
    { header: 'Industry',      key: 'industry',    width: 20 },
    { header: 'Company Size',  key: 'company_size',width: 16 },
    { header: 'Duplicate',     key: 'duplicate',   width: 11 },
    { header: 'Apply Link',    key: 'apply_url',   width: 60 },
    { header: 'Notes',         key: 'notes',       width: 30 },
    { header: 'Account',       key: 'account',     width: 18 },
    { header: 'Scraped At',    key: 'scraped_at',  width: 18 },
  ]

  styleHeader(jobSheet.getRow(1))

  jobs.forEach((job, i) => {
    const row = jobSheet.addRow({
      num:        i + 1,
      status:     job.status || 'New',
      title:      job.title || '',
      company:    job.company || '',
      location:   job.location || '',
      date_posted:job.date_posted || '',
      job_type:   job.job_type || '',
      apply_type: job.apply_type || '',
      applicants: job.applicants_count || '',
      salary:     job.salary || '',
      industry:   job.industry || '',
      company_size:job.company_size || '',
      duplicate:  job.is_duplicate ? '⚠ DUPLICATE' : '',
      apply_url:  job.apply_url || '',
      notes:      job.notes || '',
      account:    job.account_name || '',
      scraped_at: job.scraped_at ? job.scraped_at.split('T')[0] : '',
    })

    styleDataRow(row, !!job.is_duplicate, job.status, i)

    // Raw URL with hyperlink — click anywhere in the cell to open
    if (job.apply_url) {
      const urlCell = row.getCell('apply_url')
      urlCell.value = { text: job.apply_url, hyperlink: job.apply_url, tooltip: 'Open job posting' }
      urlCell.font  = { color: { argb: 'FF0077B5' }, underline: true, size: 10, name: 'Calibri' }
      urlCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false }
    }

    // Status color
    const statusCell = row.getCell('status')
    const bgColor    = STATUS_COLORS[job.status]?.argb || STATUS_COLORS['New'].argb
    const fontColor  = STATUS_FONT_COLORS[job.status]?.argb || STATUS_FONT_COLORS['New'].argb
    statusCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } }
    statusCell.font  = { bold: true, color: { argb: fontColor }, size: 10, name: 'Calibri' }
    statusCell.alignment = { horizontal: 'center', vertical: 'middle' }
  })

  // Auto-filter
  jobSheet.autoFilter = { from: 'A1', to: `Q1` }

  // ─── POSTS SHEET ─────────────────────────────────────────────
  const postSheet = workbook.addWorksheet('Posts', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { tabColor: { argb: 'FF00D4AA' } },
  })

  postSheet.columns = [
    { header: '#',            key: 'num',         width: 5  },
    { header: 'Author',       key: 'author',      width: 28 },
    { header: 'Headline',     key: 'headline',    width: 36 },
    { header: 'Post Date',    key: 'post_date',   width: 16 },
    { header: 'Content',      key: 'content',     width: 60 },
    { header: 'Reactions',    key: 'reactions',   width: 12 },
    { header: 'Comments',     key: 'comments',    width: 12 },
    { header: 'Links',        key: 'links',       width: 40 },
    { header: 'Post URL',     key: 'post_url',    width: 60 },
    { header: 'Profile URL',  key: 'author_url',  width: 60 },
    { header: 'Duplicate',    key: 'duplicate',   width: 11 },
    { header: 'Account',      key: 'account',     width: 18 },
    { header: 'Scraped At',   key: 'scraped_at',  width: 18 },
  ]

  styleHeader(postSheet.getRow(1))

  posts.forEach((post, i) => {
    const links = (() => {
      try { return JSON.parse(post.links || '[]').join(', ') }
      catch { return post.links || '' }
    })()

    const row = postSheet.addRow({
      num:       i + 1,
      author:    post.author_name || '',
      headline:  post.author_headline || '',
      post_date: post.post_date || '',
      content:   post.content || '',
      reactions: post.reactions || '0',
      comments:  post.comments || '0',
      links,
      post_url:  post.post_url || '',
      author_url:post.author_url || '',
      duplicate: post.is_duplicate ? '⚠ DUPLICATE' : '',
      account:   post.account_name || '',
      scraped_at:post.scraped_at ? post.scraped_at.split('T')[0] : '',
    })

    styleDataRow(row, !!post.is_duplicate, null, i)
    row.height = 36

    if (post.post_url) {
      const c = row.getCell('post_url')
      c.value = { text: post.post_url, hyperlink: post.post_url, tooltip: 'Open post' }
      c.font  = { color: { argb: 'FF0077B5' }, underline: true, size: 10, name: 'Calibri' }
      c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false }
    }
    if (post.author_url) {
      const c = row.getCell('author_url')
      c.value = { text: post.author_url, hyperlink: post.author_url, tooltip: 'Open profile' }
      c.font  = { color: { argb: 'FF0077B5' }, underline: true, size: 10, name: 'Calibri' }
      c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false }
    }
  })

  postSheet.autoFilter = { from: 'A1', to: `M1` }

  // ─── SUMMARY SHEET ───────────────────────────────────────────
  const summarySheet = workbook.addWorksheet('Summary', {
    properties: { tabColor: { argb: 'FFFF9500' } },
  })

  summarySheet.getColumn('A').width = 28
  summarySheet.getColumn('B').width = 18

  const addSummaryHeader = (text) => {
    const row = summarySheet.addRow([text])
    row.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 }
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0077B5' } }
    row.height = 24
  }

  const addSummaryRow = (label, value) => {
    const row = summarySheet.addRow([label, value])
    row.getCell(1).font = { color: { argb: 'FFD0D0E0' }, size: 10 }
    row.getCell(2).font = { bold: true, color: { argb: 'FF0077B5' }, size: 10 }
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF13131F' } }
    row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF13131F' } }
  }

  addSummaryHeader('📊 LinkedIn Hunter — Export Summary')
  summarySheet.addRow([])
  addSummaryHeader('Overview')
  addSummaryRow('Total Jobs Found', jobs.length)
  addSummaryRow('Total Posts Found', posts.length)
  addSummaryRow('Duplicate Jobs', jobs.filter(j => j.is_duplicate).length)
  addSummaryRow('Duplicate Posts', posts.filter(p => p.is_duplicate).length)
  addSummaryRow('Export Date', new Date().toLocaleDateString())
  summarySheet.addRow([])

  // Status breakdown
  addSummaryHeader('Job Status Breakdown')
  const statusMap = {}
  jobs.forEach(j => { statusMap[j.status || 'New'] = (statusMap[j.status || 'New'] || 0) + 1 })
  Object.entries(statusMap).forEach(([status, count]) => addSummaryRow(status, count))
  summarySheet.addRow([])

  // Top companies
  addSummaryHeader('Top Companies (by job count)')
  const companyMap = {}
  jobs.forEach(j => { if (j.company) companyMap[j.company] = (companyMap[j.company] || 0) + 1 })
  Object.entries(companyMap).sort((a, b) => b[1] - a[1]).slice(0, 15)
    .forEach(([name, count]) => addSummaryRow(name, count))

  // Save
  const filePath = getExportPath()
  await workbook.xlsx.writeFile(filePath)
  console.log(`✅ Excel exported: ${filePath}`)
  return filePath
}

module.exports = { exportToExcel }

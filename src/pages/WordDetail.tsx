import { useParams } from 'react-router-dom'
import { Page } from '../components/Page'

/** Task 19 实现:完整词条 + 发音 + 学习统计 + 编辑表单 + 删除。 */
export function WordDetail() {
  const { id } = useParams()

  return (
    <Page eyebrow="Entry" title={id ?? '词条'} back="/library">
      <p className="placeholder">待实现:词条详情、编辑与删除</p>
    </Page>
  )
}

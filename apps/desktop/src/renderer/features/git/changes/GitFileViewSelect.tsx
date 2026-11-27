import { ListBulletsIcon } from '@phosphor-icons/react/dist/csr/ListBullets';
import { TreeStructureIcon } from '@phosphor-icons/react/dist/csr/TreeStructure';
import { ZeusSelect } from '../../../ui/ZeusSelect.js';

type FileView = 'tree' | 'flat';

export function GitFileViewSelect({ zh, value, disabled, onChange }: {
  zh: boolean;
  value: FileView;
  disabled?: boolean;
  onChange: (value: FileView) => void;
}) {
  const tree = zh ? '树状结构' : 'Tree view';
  const flat = zh ? '平铺结构' : 'Flat view';
  const selected = value === 'flat' ? flat : tree;
  return <ZeusSelect<FileView>
    ariaLabel={zh ? `文件显示方式：${selected}` : `File view: ${selected}`}
    className="project-git-file-view-control"
    size="compact"
    value={value}
    disabled={disabled}
    onChange={onChange}
    triggerIcon={value === 'flat' ? <ListBulletsIcon /> : <TreeStructureIcon />}
    triggerTitle={selected}
    hideSelectedLabel
    options={[
      { value: 'tree', label: tree, icon: <TreeStructureIcon /> },
      { value: 'flat', label: flat, icon: <ListBulletsIcon /> },
    ]}
  />;
}

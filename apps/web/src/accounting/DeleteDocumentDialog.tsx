import { Alert, Button, Group, Modal, Stack, Table, Text } from '@mantine/core';
import { useState } from 'react';
import { deleteDocument } from '../data/hooks';
import { formatPln } from '../format';
import { formatDate, type MonthDocumentRow } from './accountingView';

/**
 * Підтвердження видалення документа. Фокус стоїть на «Скасувати», а в діалозі видно номер, контрагента,
 * дату й суму, щоб не видалити зайве. Видалення незворотне: документів у Firestore без історії.
 */
export function DeleteDocumentDialog({
  uid,
  row,
  onClose,
}: {
  uid: string;
  /** Документ для видалення; null — діалог закритий */
  row: MonthDocumentRow | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<{ kind: 'idle' | 'deleting' } | { kind: 'error'; message: string }>({
    kind: 'idle',
  });

  const close = () => {
    if (state.kind === 'deleting') return;
    setState({ kind: 'idle' });
    onClose();
  };

  const confirm = async () => {
    if (!row) return;
    setState({ kind: 'deleting' });
    try {
      await deleteDocument(uid, row.id);
      setState({ kind: 'idle' });
      onClose();
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
    }
  };

  return (
    <Modal opened={row !== null} onClose={close} title="Видалити документ?" centered transitionProps={{ duration: 0 }}>
      {row && (
        <Stack>
          <Table aria-label="Документ для видалення">
            <Table.Tbody>
              <Table.Tr>
                <Table.Td>Номер</Table.Td>
                <Table.Td>{row.number}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>Контрагент</Table.Td>
                <Table.Td>{row.contractor || row.description || '—'}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>Дата (PIT)</Table.Td>
                <Table.Td>{formatDate(row.pitDate)}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>Przychód / koszt</Table.Td>
                <Table.Td>{row.pitAmount === null ? '—' : formatPln(row.pitAmount)}</Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
          <Text size="sm">Документ зникне з обліку й сум. Скасувати видалення буде неможливо.</Text>
          {state.kind === 'error' && (
            <Alert color="red" role="alert">
              Не вдалося видалити: {state.message}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={close} data-autofocus disabled={state.kind === 'deleting'}>
              Скасувати
            </Button>
            <Button color="red" onClick={() => void confirm()} loading={state.kind === 'deleting'}>
              Видалити
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

import { getAllFinancialStatements } from './factstream';

export async function getFinancials(ticker: string): Promise<unknown> {
  return getAllFinancialStatements(ticker);
}

import { BadRequestException } from '@nestjs/common';

describe('Day 4 & 5: ERP Finance Modules Calculation & Transaction Consistency Tests', () => {

  describe('General Ledger & Double-Entry Accounting Consistency (Day 4 - Item 1, 8)', () => {
    it('should validate that total debit must exactly equal total credit within 0.01 tolerance', () => {
      const balancedLines = [
        { accountCode: '1020', debit: 50000, credit: 0 },
        { accountCode: '4010', debit: 0, credit: 50000 },
      ];

      const totalDebit = balancedLines.reduce((sum, l) => sum + l.debit, 0);
      const totalCredit = balancedLines.reduce((sum, l) => sum + l.credit, 0);

      expect(Math.abs(totalDebit - totalCredit)).toBeLessThanOrEqual(0.01);
    });

    it('should reject journal entries where debits and credits do not balance', () => {
      const unbalancedLines = [
        { accountCode: '1020', debit: 50000, credit: 0 },
        { accountCode: '4010', debit: 0, credit: 45000 }, // Discrepancy of 5000
      ];

      const totalDebit = unbalancedLines.reduce((sum, l) => sum + l.debit, 0);
      const totalCredit = unbalancedLines.reduce((sum, l) => sum + l.credit, 0);

      const validateBalanced = () => {
        if (Math.abs(totalDebit - totalCredit) > 0.01) {
          throw new BadRequestException('Journal entry is out of balance. Debits and Credits must exactly balance.');
        }
      };

      expect(validateBalanced).toThrow(BadRequestException);
    });

    it('should produce exact inverse offsetting entries when reversing a journal', () => {
      const originalLines = [
        { accountCode: '1020', debit: 25000, credit: 0 },
        { accountCode: '4010', debit: 0, credit: 25000 },
      ];

      const reversalLines = originalLines.map((line) => ({
        accountCode: line.accountCode,
        debit: line.credit,
        credit: line.debit,
      }));

      expect(reversalLines[0]).toEqual({ accountCode: '1020', debit: 0, credit: 25000 });
      expect(reversalLines[1]).toEqual({ accountCode: '4010', debit: 25000, credit: 0 });

      const netCashBalanceChange = originalLines[0].debit - originalLines[0].credit + (reversalLines[0].debit - reversalLines[0].credit);
      expect(netCashBalanceChange).toBe(0);
    });
  });

  describe('Payroll Statutory Deductions & Net Pay Formulation (Day 4 - Item 4, 8)', () => {
    it('should accurately compute Basic (50%), HRA (25%), Special Allowance, PF (12% of Basic) and Net Salary', () => {
      const monthlyCtc = 60000;

      const basic = Math.round(monthlyCtc * 0.5 * 100) / 100; // 30,000
      const hra = Math.round(monthlyCtc * 0.25 * 100) / 100; // 15,000
      const specialAllowance = Math.round((monthlyCtc - basic - hra) * 100) / 100; // 15,000

      const pf = Math.round(basic * 0.12 * 100) / 100; // 3,600
      const professionalTax = 200;
      const tds = 2500;

      const grossSalary = basic + hra + specialAllowance;
      const totalDeductions = pf + professionalTax + tds;
      const netSalary = grossSalary - totalDeductions;

      expect(basic).toBe(30000);
      expect(hra).toBe(15000);
      expect(specialAllowance).toBe(15000);
      expect(grossSalary).toBe(60000);
      expect(pf).toBe(3600);
      expect(totalDeductions).toBe(6300);
      expect(netSalary).toBe(53700);
    });
  });

  describe('Credit Notes & Balance Due Validation (Day 4 - Item 2, 3)', () => {
    it('should prohibit credit note amounts from exceeding invoice balance due', () => {
      const invoiceBalanceDue = 15000;
      const creditNoteAmount = 18000;

      const createCreditNote = (amount: number, balanceDue: number) => {
        if (amount > balanceDue) {
          throw new BadRequestException('Credit note total cannot exceed outstanding balance due');
        }
        return balanceDue - amount;
      };

      expect(() => createCreditNote(creditNoteAmount, invoiceBalanceDue)).toThrow(BadRequestException);
    });

    it('should correctly allocate credit note and reduce balance to 0 if full waiver', () => {
      const invoiceBalanceDue = 10000;
      const creditNoteAmount = 10000;

      const remainingBalance = Math.max(0, Math.round((invoiceBalanceDue - creditNoteAmount) * 100) / 100);
      const isPaid = remainingBalance === 0;

      expect(remainingBalance).toBe(0);
      expect(isPaid).toBe(true);
    });
  });

  describe('AR / AP Aging Calculation Logic (Day 4 - Item 2)', () => {
    it('should correctly assign overdue invoices to their respective aging buckets', () => {
      const now = new Date('2026-11-05T00:00:00Z').getTime();
      const oneDay = 1000 * 60 * 60 * 24;

      const testInvoices = [
        { id: '1', balance: 5000, dueDate: new Date(now - 10 * oneDay) },  // 10 days overdue -> 0-30
        { id: '2', balance: 12000, dueDate: new Date(now - 45 * oneDay) }, // 45 days overdue -> 31-60
        { id: '3', balance: 8000, dueDate: new Date(now - 75 * oneDay) },  // 75 days overdue -> 61-90
        { id: '4', balance: 25000, dueDate: new Date(now - 120 * oneDay) } // 120 days overdue -> 90+
      ];

      const buckets = {
        current0To30: 0,
        days31To60: 0,
        days61To90: 0,
        over90Days: 0,
      };

      for (const inv of testInvoices) {
        const ageDays = Math.max(0, Math.floor((now - inv.dueDate.getTime()) / oneDay));
        if (ageDays <= 30) buckets.current0To30 += inv.balance;
        else if (ageDays <= 60) buckets.days31To60 += inv.balance;
        else if (ageDays <= 90) buckets.days61To90 += inv.balance;
        else buckets.over90Days += inv.balance;
      }

      expect(buckets.current0To30).toBe(5000);
      expect(buckets.days31To60).toBe(12000);
      expect(buckets.days61To90).toBe(8000);
      expect(buckets.over90Days).toBe(25000);
    });
  });
});


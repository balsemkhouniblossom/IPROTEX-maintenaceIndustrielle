import { buildSlowQueryLogMessage, isSlowQuery } from './slow-query-logger';

describe('slow-query-logger', () => {
  describe('isSlowQuery', () => {
    it('is true when duration meets the threshold', () => {
      expect(
        isSlowQuery(
          { commandName: 'find', databaseName: 'gmao', duration: 200 },
          200,
        ),
      ).toBe(true);
    });

    it('is true when duration exceeds the threshold', () => {
      expect(
        isSlowQuery(
          { commandName: 'find', databaseName: 'gmao', duration: 350 },
          200,
        ),
      ).toBe(true);
    });

    it('is false when duration is below the threshold', () => {
      expect(
        isSlowQuery(
          { commandName: 'find', databaseName: 'gmao', duration: 50 },
          200,
        ),
      ).toBe(false);
    });
  });

  describe('buildSlowQueryLogMessage', () => {
    it('includes the command, database, and duration', () => {
      const message = buildSlowQueryLogMessage({
        commandName: 'aggregate',
        databaseName: 'gmao',
        duration: 512,
      });

      expect(message).toBe('Slow query: aggregate on gmao took 512ms');
    });
  });
});

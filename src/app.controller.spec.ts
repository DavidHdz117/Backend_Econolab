import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(() => {
    appController = new AppController(new AppService());
  });

  it('returns the backend welcome message', () => {
    expect(appController.getHello()).toBe('Backend Sistema ECONOLAB');
  });
});

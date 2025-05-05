import { Injectable } from '@angular/core';
import { ApplicationInsights } from '@microsoft/applicationinsights-web';
import { AngularPlugin } from '@microsoft/applicationinsights-angularplugin-js';
import { Router } from '@angular/router';

@Injectable({
  providedIn: 'root'
})
export class AppInsightsService {
  private angularPlugin: AngularPlugin;
  private appInsights: ApplicationInsights;

  constructor(private router: Router) {
    this.angularPlugin = new AngularPlugin();
    this.appInsights = new ApplicationInsights({
      config: {
        connectionString: 'InstrumentationKey=be2e2c9c-780e-4ebf-899e-9ae69b3edede;IngestionEndpoint=https://germanywestcentral-1.in.applicationinsights.azure.com/;LiveEndpoint=https://germanywestcentral.livediagnostics.monitor.azure.com/;ApplicationId=e4e28e1c-e942-40ea-a0a5-277e33e6d646',
        enableAutoRouteTracking: true,
        extensions: [this.angularPlugin],
        extensionConfig: {
          [this.angularPlugin.identifier]: { router: this.router }
        }
      }
    });
  }

  init(): void {
    this.appInsights.loadAppInsights();
    this.appInsights.trackPageView();
  }

  trackEvent(name: string, properties?: { [key: string]: any }): void {
    this.appInsights.trackEvent({ name }, properties);
  }

  trackException(exception: Error, properties?: { [key: string]: any }): void {
    this.appInsights.trackException({ exception, properties });
  }
}
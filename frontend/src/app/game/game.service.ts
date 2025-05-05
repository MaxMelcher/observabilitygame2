import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError } from 'rxjs';
import { AppInsightsService } from '../services/app-insights.service';
import { environment } from '../../environments/environment';

interface PlayerScore {
  playerName: string;
  time: number;  // time in milliseconds
  created: Date;
  hash?: string;
}

@Injectable({
  providedIn: 'root'
})
export class GameService {
  private apiUrl = environment.API;
  private readonly SECRET_KEY = 'observability-game-2025'; // In production, this should be in environment config

  constructor(
    private http: HttpClient,
    private appInsights: AppInsightsService
  ) { }

  private async generateHash(score: PlayerScore): Promise<string> {
    const timeStr = score.time.toFixed(3);
    const createdMs = score.created.getTime(); // Get Unix timestamp in milliseconds
    const payload = `${score.playerName}|${timeStr}|${createdMs}|${this.SECRET_KEY}`;
    return await this.sha256(payload);
  }

  private async sha256(message: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  getTopScores(): Observable<PlayerScore[]> {
    this.appInsights.trackEvent('GetTopScores');
    return this.http.get<PlayerScore[]>(`${this.apiUrl}/scores`).pipe(
      catchError(error => {
        this.appInsights.trackException(error);
        throw error;
      })
    );
  }

  async submitScore(score: PlayerScore): Promise<Observable<PlayerScore>> {
    this.appInsights.trackEvent('SubmitScore', { playerName: score.playerName, time: score.time });
    score.hash = await this.generateHash(score);
    return this.http.post<PlayerScore>(`${this.apiUrl}/scores`, score).pipe(
      catchError(error => {
        this.appInsights.trackException(error);
        throw error;
      })
    );
  }
}

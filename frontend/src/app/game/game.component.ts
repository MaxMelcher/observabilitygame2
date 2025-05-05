import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as THREE from 'three';
import { GameService } from './game.service';
import { AppInsightsService } from '../services/app-insights.service';

interface MovingPlatform {
  mesh: THREE.Mesh;
  startPos: THREE.Vector2;
  endPos: THREE.Vector2;
  speed: number;  // Speed in units per second
  progress: number;
  direction: 1 | -1;
}

interface BouncePlatform {
  mesh: THREE.Mesh;
  bounceForce: number;
}

@Component({
  selector: 'app-game',
  templateUrl: './game.component.html',
  styleUrls: ['./game.component.sass'],
  imports: [CommonModule, FormsModule],
  standalone: true
})
export class GameComponent implements AfterViewInit, OnDestroy {
  @ViewChild('gameCanvasContainer') gameContainer!: ElementRef;
  @ViewChild('nameInput') nameInput!: ElementRef;
  
  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private renderer!: THREE.WebGLRenderer;
  private clock: THREE.Clock = new THREE.Clock();  // Add clock
  private player!: THREE.Mesh;
  private ground!: THREE.Mesh;
  private platforms: THREE.Mesh[] = [];
  private movingPlatforms: MovingPlatform[] = [];
  private bouncePlatforms: BouncePlatform[] = [];
  private goal!: THREE.Mesh;
  private startPlatform!: THREE.Mesh;
  
  private playerVelocity = new THREE.Vector2();
  private isJumping = false;
  gameStarted = false;  // Changed to public
  gameTime = 0;
  gameTimeMs = 0;
  private startTime = 0;
  private animationId: number | null = null;
  private leaderboardInterval: number | undefined;

  // Game dimensions
  private readonly WORLD_WIDTH = 40;  
  private readonly WORLD_HEIGHT = 15;
  private readonly PLAYER_START_X = -16;  
  private readonly PLAYER_START_Y = 2;
  private readonly GOAL_X = 16;  
  private readonly GOAL_Y = 2;

  // Movement speeds (units per second)
  private readonly PLAYER_MOVE_SPEED = 12; // 12 units per second
  private readonly PLAYER_JUMP_FORCE = 18; // 18 units per second
  private readonly GRAVITY = 45; // 45 units per second squared
  private readonly PLATFORM_MOVE_SPEED = 0.8; // Platform movement scaling factor

  // Platform settings
  private readonly VERTICAL_MOVE_DISTANCE = 3;
  private readonly HORIZONTAL_MOVE_DISTANCE = 4;
  private readonly BOUNCE_FORCE = 1.8; // Increased from 0.6 to 1.8 (3x higher)

  // Platform movement properties
  private readonly PLATFORM_CYCLE_SPEED = 3; // Speed of the movement cycle

  gameCompleted = false;
  timeoutOccurred = false;
  playerName = '';
  scoreSubmitted = false;
  isSubmittingScore = false;  // Add this line
  leaderboardScores: Array<{playerName: string, time: number}> = [];
  errorMessage = '';

  private moveDirection = new THREE.Vector2();

  constructor(
    private gameService: GameService,
    private appInsights: AppInsightsService
  ) {
    this.loadLeaderboard();
    this.startLeaderboardRefresh();
    // Load saved player name from localStorage
    const savedName = localStorage.getItem('playerName');
    if (savedName) {
      this.playerName = savedName;
    }
  }

  private startLeaderboardRefresh() {
    const REFRESH_INTERVAL_MS = 10000; // 10 seconds
    this.leaderboardInterval = window.setInterval(() => {
      this.loadLeaderboard();
    }, REFRESH_INTERVAL_MS);
  }

  ngAfterViewInit() {
    this.initScene();
    this.initPlayer();
    this.initLevel();
    this.setupControls();
    this.animate();
  }

  ngOnDestroy() {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
    }
    if (this.leaderboardInterval) {
      clearInterval(this.leaderboardInterval);
    }
    this.renderer.dispose();
  }

  private initScene() {
    this.scene = new THREE.Scene();
    
    // Set camera to exactly fit the world width
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.OrthographicCamera(
      -this.WORLD_WIDTH/2,  // Left
      this.WORLD_WIDTH/2,   // Right
      (this.WORLD_WIDTH/aspect)/2,  // Top
      -(this.WORLD_WIDTH/aspect)/2, // Bottom
      0.1,
      1000
    );
    
    this.renderer = new THREE.WebGLRenderer();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.gameContainer.nativeElement.appendChild(this.renderer.domElement);
    
    // Add basic lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(0, 1, 1);
    this.scene.add(directionalLight);

    // Position camera
    this.camera.position.set(0, 0, 10);
    this.camera.lookAt(0, 0, 0);
  }

  private initPlayer() {
    const geometry = new THREE.PlaneGeometry(1, 1);
    // Load the Azure logo texture
    const textureLoader = new THREE.TextureLoader();
    const material = new THREE.MeshBasicMaterial({
      map: textureLoader.load('assets/azure.svg'),
      transparent: true,
      side: THREE.DoubleSide
    });
    this.player = new THREE.Mesh(geometry, material);
    this.respawnPlayer();
    this.scene.add(this.player);

    // Add ground (slightly lower and red)
    const groundGeometry = new THREE.PlaneGeometry(this.WORLD_WIDTH, 1);
    const groundMaterial = new THREE.MeshLambertMaterial({ color: 0xff0000, side: THREE.DoubleSide });
    this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
    this.ground.position.y = -2;
    this.scene.add(this.ground);
  }

  private initLevel() {
    const platformGeometry = new THREE.PlaneGeometry(3, 0.5);
    const platformMaterial = new THREE.MeshLambertMaterial({ color: 0x808080, side: THREE.DoubleSide });
    
    // Start platform
    const startGeometry = new THREE.PlaneGeometry(4, 0.5);
    const startMaterial = new THREE.MeshLambertMaterial({ color: 0x4CAF50, side: THREE.DoubleSide });
    this.startPlatform = new THREE.Mesh(startGeometry, startMaterial);
    this.startPlatform.position.set(this.PLAYER_START_X, this.PLAYER_START_Y - 1, 0);
    this.scene.add(this.startPlatform);
    
    // Create static platforms with random variations
    const basePositions = [
      { x: -12, y: 3 },
      { x: -4, y: 3 },
      { x: 4, y: 3 },
      { x: 12, y: 3 }
    ];

    for (const pos of basePositions) {
      const platform = new THREE.Mesh(platformGeometry, platformMaterial);
      // Add some randomness to platform positions
      const randomX = pos.x + (Math.random() * 2 - 1);
      const randomY = pos.y + (Math.random() * 1.5 - 0.75);
      platform.position.set(randomX, randomY, 0);
      this.platforms.push(platform);
      this.scene.add(platform);
    }

    // Add bounce platforms (blue) lower
    const bouncePlatformGeometry = new THREE.PlaneGeometry(2, 0.5);
    const bouncePlatformMaterial = new THREE.MeshLambertMaterial({ color: 0x2196F3, side: THREE.DoubleSide });
    
    const bouncePositions = [
      { x: -6, y: 5 },   // Lowered
      { x: 6, y: 5.5 }   // Lowered
    ];

    for (const pos of bouncePositions) {
      const platform = new THREE.Mesh(bouncePlatformGeometry, bouncePlatformMaterial);
      platform.position.set(pos.x, pos.y, 0);
      this.bouncePlatforms.push({
        mesh: platform,
        bounceForce: this.BOUNCE_FORCE
      });
      this.scene.add(platform);
    }

    // Add moving platforms
    const movingPlatformMaterial = new THREE.MeshLambertMaterial({ color: 0xe91e63, side: THREE.DoubleSide });

    // Horizontal moving platforms (red bars)
    const horizontalMovers = [
      { centerX: -8, y: 2 },
      { centerX: 8, y: 2 }
    ];

    // Update the horizontal moving platforms initialization
    for (const pos of horizontalMovers) {
      const platform = new THREE.Mesh(platformGeometry, movingPlatformMaterial);
      platform.position.set(pos.centerX, pos.y, 0);
      platform.rotation.z = Math.PI / 2; // Rotate 90 degrees around Z axis
      
      this.movingPlatforms.push({
        mesh: platform,
        startPos: new THREE.Vector2(pos.centerX - this.HORIZONTAL_MOVE_DISTANCE, pos.y),
        endPos: new THREE.Vector2(pos.centerX + this.HORIZONTAL_MOVE_DISTANCE, pos.y),
        speed: this.PLATFORM_MOVE_SPEED,
        progress: Math.random(),
        direction: Math.random() < 0.5 ? 1 : -1
      });
      
      this.scene.add(platform);
    }

    // Vertical moving platforms
    const verticalMovers = [
      { x: 0, centerY: 2 }
    ];

    // Update vertical moving platforms initialization
    for (const pos of verticalMovers) {
      const platform = new THREE.Mesh(platformGeometry, movingPlatformMaterial);
      platform.position.set(pos.x, pos.centerY, 0);
      
      this.movingPlatforms.push({
        mesh: platform,
        startPos: new THREE.Vector2(pos.x, pos.centerY - this.VERTICAL_MOVE_DISTANCE),
        endPos: new THREE.Vector2(pos.x, pos.centerY + this.VERTICAL_MOVE_DISTANCE),
        speed: this.PLATFORM_MOVE_SPEED,
        progress: 0,
        direction: 1
      });
      
      this.scene.add(platform);
    }

    // Goal platform (golden and wider)
    const goalGeometry = new THREE.PlaneGeometry(4, 0.5);
    const goalMaterial = new THREE.MeshLambertMaterial({ color: 0xffd700, side: THREE.DoubleSide });
    this.goal = new THREE.Mesh(goalGeometry, goalMaterial);
    this.goal.position.set(this.GOAL_X, this.GOAL_Y, 0);
    this.scene.add(this.goal);
  }

  private respawnPlayer() {
    this.player.position.set(this.PLAYER_START_X, this.PLAYER_START_Y, 0);
    this.playerVelocity.set(0, 0);
    this.isJumping = false;
  }

  private setupControls() {
    document.addEventListener('keydown', (event) => {
      if (!this.gameStarted) {
        this.gameStarted = true;
        this.startTime = Date.now();
      }

      switch (event.code) {
        case 'ArrowLeft':
          this.moveDirection.x = -1;
          break;
        case 'ArrowRight':
          this.moveDirection.x = 1;
          break;
        case 'Space':
          if (!this.isJumping) {
            this.playerVelocity.y = this.PLAYER_JUMP_FORCE;
            this.isJumping = true;
          }
          break;
      }
    });

    document.addEventListener('keyup', (event) => {
      switch (event.code) {
        case 'ArrowLeft':
          if (this.moveDirection.x < 0) this.moveDirection.x = 0;
          break;
        case 'ArrowRight':
          if (this.moveDirection.x > 0) this.moveDirection.x = 0;
          break;
      }
    });
  }

  private updateMovingPlatforms() {
    const delta = this.clock.getDelta();
    const time = this.clock.getElapsedTime();
    
    for (const platform of this.movingPlatforms) {
      if (platform.mesh.rotation.z === Math.PI / 2) { // Horizontal moving platforms
        // Use sine wave for smooth back-and-forth movement
        const xOffset = Math.sin(time * 3) * this.HORIZONTAL_MOVE_DISTANCE;
        const newX = platform.startPos.x + this.HORIZONTAL_MOVE_DISTANCE + xOffset;
        platform.mesh.position.x = newX;
      } else { // Vertical moving platforms
        // Use cosine wave for smooth up-down movement
        const yOffset = Math.cos(time * 3) * this.VERTICAL_MOVE_DISTANCE;
        const newY = platform.startPos.y + this.VERTICAL_MOVE_DISTANCE + yOffset;
        platform.mesh.position.y = newY;
      }
    }
  }

  private animate() {
    this.animationId = requestAnimationFrame(() => this.animate());
    
    const delta = this.clock.getDelta();
    
    // Update player velocity based on move direction
    if (this.moveDirection.x !== 0) {
      this.playerVelocity.x = this.moveDirection.x * this.PLAYER_MOVE_SPEED * delta;
    } else {
      this.playerVelocity.x = 0;
    }
    
    // Apply gravity with delta time
    this.playerVelocity.y -= this.GRAVITY * delta;
    
    // Update player position with current velocity
    this.player.position.x += this.playerVelocity.x;
    this.player.position.y += this.playerVelocity.y * delta;
    
    // Update moving platforms
    this.updateMovingPlatforms();
    
    // Check for timeout (30 seconds)
    if (this.gameStarted && !this.gameCompleted && !this.timeoutOccurred && this.gameTime >= 30) {
      this.timeoutOccurred = true;
      this.gameCompleted = true;
      const currentTime = this.gameTime + (this.gameTimeMs / 1000);
      this.appInsights.trackEvent('GameFailed', { 
        reason: 'TimeOut',
        time: currentTime.toString(),
        ...(this.playerName && { playerName: this.playerName })
      });
      this.startTime = Date.now(); // Reset the timer
    }
    
    // Check ground collision for respawn and penalty
    const playerBottom = this.player.position.y - 0.5;
    if (playerBottom < -1) {
      this.respawnPlayer();
      if (this.gameStarted && !this.gameCompleted) {
        this.startTime -= 5000; // 5 second penalty
        const currentTime = this.gameTime + (this.gameTimeMs / 1000);
        this.appInsights.trackEvent('GameFailed', { 
          reason: 'GroundTouch',
          time: currentTime.toString(),
          ...(this.playerName && { playerName: this.playerName })
        });
      }
    }

    // Check bounce platforms first
    for (const bouncePlatform of this.bouncePlatforms) {
      if (this.checkCollision(this.player, bouncePlatform.mesh) && this.playerVelocity.y <= 0) {
        // Apply bounce force scaled by the bounce force value
        this.playerVelocity.y = this.PLAYER_JUMP_FORCE * bouncePlatform.bounceForce;
        this.isJumping = true;
      }
    }

    // Check platform collisions
    let onPlatform = false;
    const allPlatforms = [
      ...this.platforms, 
      this.startPlatform, 
      this.goal,
      ...this.movingPlatforms.map(p => p.mesh)
    ];
    
    for (const platform of allPlatforms) {
      if (this.checkCollision(this.player, platform)) {
        const movingPlatform = this.movingPlatforms.find(p => p.mesh === platform);
        
        if (movingPlatform) {
          if (platform.rotation.z === Math.PI / 2) { // Horizontal moving platform
            // Calculate platform movement
            const platformVelocityX = (movingPlatform.endPos.x - movingPlatform.startPos.x) * 
                                    movingPlatform.speed * movingPlatform.direction;
            
            // Move player with platform
            this.player.position.x += platformVelocityX * delta;
          } else { // Vertical moving platform
            if (this.playerVelocity.y < 0) {
              this.player.position.y = platform.position.y + 0.75;
              this.playerVelocity.y = 0;
              this.isJumping = false;
              onPlatform = true;
            }
          }
        } else {
          // Regular platform collision
          if (this.playerVelocity.y < 0) {
            this.player.position.y = platform.position.y + 0.75;
            this.playerVelocity.y = 0;
            this.isJumping = false;
            onPlatform = true;
          }
        }
      }
    }

    // Check goal collision
    if (this.checkCollision(this.player, this.goal)) {
      this.completeGame();
    }

    // Update game time
    if (this.gameStarted && !this.gameCompleted) {
      const currentTime = Date.now() - this.startTime;
      this.gameTime = Math.floor(currentTime / 1000);
      this.gameTimeMs = currentTime % 1000;
    }
    
    this.renderer.render(this.scene, this.camera);
  }

  private checkCollision(obj1: THREE.Mesh, obj2: THREE.Mesh): boolean {
    // Store dimensions during object creation
    const width1 = (obj1.geometry as THREE.PlaneGeometry).parameters.width;
    const height1 = (obj1.geometry as THREE.PlaneGeometry).parameters.height;
    const width2 = (obj2.geometry as THREE.PlaneGeometry).parameters.width;
    const height2 = (obj2.geometry as THREE.PlaneGeometry).parameters.height;
    
    const box1 = new THREE.Box2(
      new THREE.Vector2(obj1.position.x - width1/2, obj1.position.y - height1/2),
      new THREE.Vector2(obj1.position.x + width1/2, obj1.position.y + height1/2)
    );
    const box2 = new THREE.Box2(
      new THREE.Vector2(obj2.position.x - width2/2, obj2.position.y - height2/2),
      new THREE.Vector2(obj2.position.x + width2/2, obj2.position.y + height2/2)
    );
    return box1.intersectsBox(box2);
  }

  private completeGame() {
    if (!this.gameCompleted) {
      this.gameCompleted = true;
      // Stop player movement
      this.playerVelocity.x = 0;
      this.playerVelocity.y = 0;
      // Disable controls
      this.gameStarted = false;
      
      // Track game completion with App Insights
      const completionTime = this.gameTime + (this.gameTimeMs / 1000);
      const properties: { [key: string]: string } = {
        time: completionTime.toString()
      };
      if (this.playerName) {
        properties['playerName'] = this.playerName;
      }
      this.appInsights.trackEvent('GameCompleted', properties);

      // Focus the name input after a short delay to ensure the UI is ready
      setTimeout(() => {
        if (this.nameInput) {
          this.nameInput.nativeElement.focus();
        }
      }, 100);
    }
  }

  restartGame() {
    this.gameCompleted = false;
    this.scoreSubmitted = false;
    this.errorMessage = '';
    this.gameTime = 0;
    this.gameTimeMs = 0;
    this.gameStarted = false;
    this.startTime = Date.now();
    this.timeoutOccurred = false;
    this.respawnPlayer();
  }

  onNameChange(newName: string) {
    localStorage.setItem('playerName', newName);
  }

  async submitScore() {
    if (this.playerName && this.gameCompleted && !this.scoreSubmitted) {
      this.errorMessage = '';
      this.isSubmittingScore = true;
      const score = {
        playerName: this.playerName,
        time: this.gameTime + (this.gameTimeMs / 1000),
        created: new Date()
      };
      
      try {
        const scoreObservable = await this.gameService.submitScore(score);
        scoreObservable.subscribe({
          next: () => {
            this.loadLeaderboard();
            this.errorMessage = '';
            this.scoreSubmitted = true;
            this.isSubmittingScore = false;
          },
          error: (error) => {
            console.error('Failed to submit score:', error);
            if (error.status === 400) {
              if (error.error === 'nice try! Cheater... :)') {
                this.errorMessage = 'Score submission failed: Data integrity check failed.';
              } else {
                this.errorMessage = 'Username contains inappropriate content or email. Please choose a different name.';
              }
            } else {
              this.errorMessage = 'Failed to submit score. Please try again.';
            }
            this.isSubmittingScore = false;
          }
        });
      } catch (error) {
        console.error('Failed to generate score hash:', error);
        this.errorMessage = 'Failed to submit score. Please try again.';
        this.isSubmittingScore = false;
      }
    }
  }

  private loadLeaderboard() {
    this.gameService.getTopScores().subscribe({
      next: (scores) => {
        this.leaderboardScores = scores;
      },
      error: (error) => {
        console.error('Failed to load leaderboard:', error);
        this.leaderboardScores = []; // Reset to empty array on error
      }
    });
  }
}

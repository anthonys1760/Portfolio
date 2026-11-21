---
title: "React Native Mobile Architecture: Lessons from Production"
description: "Module boundaries, native bridges, navigation, and where state should live in a React Native app."
date: "2026-04-13"
updated: "2026-11-11"
category: "Mobile"
readTime: "3 min read"
hero: "/blog/images/react-native-mobile-architecture-lessons-from-production.webp"
heroAlt: "React Native Mobile Architecture: Lessons from Production"
heroWidth: 1600
heroHeight: 1200
---

Architecture decisions made early decide whether a React Native app stays easy to change or drowns in structural debt. The ecosystem talks about the bridge and JSI. The practical battle is how the codebase is structured: modules, native boundaries, navigation, and where state lives.

## The Module Layer Pattern

Most React Native apps start as a monolith and die as a monolith. The biggest architectural win I've implemented is treating major features as isolated modules with explicit dependency contracts. Each module owns its navigation, state, and native bridges. This isn't about microservices—it's about cognitive load and parallel development.

```typescript
// modules/payments/index.ts
export interface PaymentsModule {
  screens: {
    CheckoutScreen: React.ComponentType<CheckoutProps>;
    PaymentMethodsScreen: React.ComponentType;
  };
  hooks: {
    usePaymentMethods: () => PaymentMethod[];
    useCheckout: () => CheckoutAPI;
  };
  services: {
    processPayment: (params: PaymentParams) => Promise<PaymentResult>;
  };
}

// modules/payments/PaymentsModule.tsx
class PaymentsModuleImpl implements PaymentsModule {
  constructor(
    private analytics: AnalyticsService,
    private api: APIClient
  ) {}

  screens = {
    CheckoutScreen: lazy(() => import('./screens/CheckoutScreen')),
    PaymentMethodsScreen: lazy(() => import('./screens/PaymentMethodsScreen')),
  };

  hooks = {
    usePaymentMethods: () => {
      // Module-scoped hook implementation
      return useQuery(['payment-methods'], () => 
        this.api.get('/payment-methods')
      );
    },
    useCheckout: () => createCheckoutHook(this.api, this.analytics),
  };

  services = {
    processPayment: async (params) => {
      this.analytics.track('payment_initiated', params);
      return this.api.post('/payments', params);
    },
  };
}
```

> **Key insight:** Modules should communicate through well-defined interfaces, never by importing components or hooks directly from other modules. This lets you refactor internals without breaking the rest of the app.

## Native Bridge Organization

The new architecture (Fabric + TurboModules) is great, but you still need a coherent strategy for native code. I organize native modules by *capability*, not by platform. Each capability gets a TypeScript interface, platform-specific implementations, and a unified JS API. This makes mocking trivial for testing and keeps platform differences contained.

```typescript
// native/capabilities/biometrics/index.ts
export interface BiometricsCapability {
  isAvailable(): Promise<boolean>;
  authenticate(reason: string): Promise<BiometricResult>;
  getSupportedTypes(): Promise<BiometricType[]>;
}

// native/capabilities/biometrics/BiometricsModule.ts
import { NativeModules } from 'react-native';

const { RNBiometrics } = NativeModules;

export class BiometricsModule implements BiometricsCapability {
  async isAvailable(): Promise<boolean> {
    if (!RNBiometrics) return false;
    const { available } = await RNBiometrics.isSensorAvailable();
    return available;
  }

  async authenticate(reason: string): Promise<BiometricResult> {
    const { success, error } = await RNBiometrics.simplePrompt({
      promptMessage: reason,
      cancelButtonText: 'Cancel',
    });
    
    return {
      authenticated: success,
      error: error ? this.mapNativeError(error) : undefined,
    };
  }

  async getSupportedTypes(): Promise<BiometricType[]> {
    const { biometryType } = await RNBiometrics.isSensorAvailable();
    return biometryType ? [biometryType as BiometricType] : [];
  }

  private mapNativeError(error: string): BiometricError {
    // Map platform-specific errors to unified error types
    if (error.includes('cancelled')) return 'USER_CANCELLED';
    if (error.includes('lockout')) return 'LOCKED_OUT';
    return 'UNKNOWN';
  }
}
```

## Navigation as Infrastructure

React Navigation is the de facto standard, but treat it as infrastructure, not application code. I create a routing layer that decouples navigation logic from screens. This means you can deep link to any screen with type-safe parameters, and navigation logic lives in one place instead of scattered across 50 `navigation.navigate()` calls.

```typescript
// navigation/Router.ts
export class Router {
  constructor(private navRef: NavigationContainerRef) {}

  // Type-safe navigation methods
  goToCheckout(params: { cartId: string; promoCode?: string }) {
    this.navRef.navigate('Payments', {
      screen: 'Checkout',
      params,
    });
  }

  goToProductDetails(productId: string) {
    this.navRef.navigate('Catalog', {
      screen: 'ProductDetails',
      params: { productId },
    });
  }

  // Deep linking handled centrally
  handleDeepLink(url: string) {
    const route = this.parseDeepLink(url);
    
    if (route.path === '/products/:id') {
      this.goToProductDetails(route.params.id);
    } else if (route.path === '/checkout') {
      this.goToCheckout({ cartId: route.params.cartId });
    }
  }

  private parseDeepLink(url: string): ParsedRoute {
    // Centralized deep link parsing logic
    return parseURL(url, this.routeConfig);
  }
}
```

> **Warning:** Don't pass navigation objects down through props. Use a router singleton or context. Passing navigation as props creates tight coupling and makes testing painful.

## Performance Boundaries

React Native performance issues are almost always about unnecessary re-renders or bridge congestion. I establish performance boundaries using `React.memo` aggressively at the screen level and use separate bridge channels for high-frequency events. For lists, FlatList with proper `keyExtractor` and `getItemLayout` is non-negotiable.

- **Screen-level memoization:** Wrap every screen component in React.memo with a custom comparison function that checks route params
- **Bridge batching:** Never send individual bridge calls in loops—batch them or use a dedicated high-frequency channel
- **Image optimization:** Use FastImage with aggressive caching and always specify dimensions to prevent layout thrashing
- **Hermes + RAM bundles:** Enable Hermes and use RAM bundle format for faster startup on Android
- **Monitor with Flipper:** Use Flipper's performance plugins in development to catch bridge bottlenecks before they hit production

## The Build System

Your CI/CD pipeline will make or break your velocity. I use Fastlane for both platforms with environment-specific build configurations managed through `.env` files and react-native-config. The key is making builds reproducible and keeping build times under 15 minutes. Cache your Gradle/CocoaPods dependencies aggressively, and use EAS Build if you can't maintain your own build infrastructure.

The architecture patterns that matter in React Native aren't exotic—they're the boring fundamentals applied consistently. Modular boundaries, explicit interfaces, centralized infrastructure, and performance monitoring. Get these right early, and you'll spend your time shipping features instead of untangling dependencies.

## Where state should live

A module that owns its state still has to pick a tool. Start with what the framework already gives you. Local component state is enough for one screen. Context is enough when a few children share a value that changes rarely. A dedicated store earns its place when many screens read and update the same session or domain data and those updates are getting hard to follow.

Redux, MobX, Recoil, and a small hook-based store are the usual later options. Adopting one before the app has shown the need adds ceremony. The failure mode is extra indirection and re-renders that cost more than the feature did.

```javascript
const UserProfile = () => {
  const [profile, setProfile] = useState({
    name: '',
    email: '',
    preferences: {}
  });

  const updateProfile = (updates) => {
    setProfile(current => ({ ...current, ...updates }));
  };
};
```

When a store is justified, keep each update narrow so one slice does not re-render the whole tree. Measure that before adding another layer. The progression is local state, then context, then a store.

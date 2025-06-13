
import React, { createContext, useState, useContext, useEffect, ReactNode, useCallback, useRef, useMemo } from 'react';
import { AuthUser, Session } from '@supabase/supabase-js'; // Ensure AuthUser and Session are imported
import { supabase, getSupabaseUserId } from '../supabaseClient'; 
import { User as AppUserType } from '../types'; 
import { Database } from '../types/supabase'; 
import { SUPER_ADMIN_EMAIL } from '../constants.tsx'; // Changed from @/constants.tsx

export interface AppUser extends AppUserType {
  isSuperAdmin: boolean;
  isActive: boolean;
  isFallback?: boolean; // Added to identify fallback profiles
}

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

interface AuthContextType {
  user: AppUser | null;
  session: Session | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  login: (email: string, password_not_name: string) => Promise<void>;
  register: (email: string, name: string, password_not_name: string) => Promise<void>;
  logout: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const PROFILE_FETCH_TIMEOUT = 20000; 
const TIMEOUT_SYMBOL = Symbol("timeout_occurred");
const ABORT_SYMBOL_INTERNAL = Symbol("aborted_internally_or_externally");

const activeProfileFetches = new Map<string, Promise<AppUser | null>>();

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);
  
  const profileFetchControllerMapRef = useRef(new Map<string, AbortController>());

  const fetchUserProfile = useCallback(async (supabaseUser: AuthUser | null, sourceCall: string): Promise<AppUser | null> => {
    const userId = supabaseUser?.id;
    const logPrefix = `AuthContext:fetchUserProfile(user: ${userId?.substring(0,8) || 'null'}, source: ${sourceCall}) -`;
    console.log(`${logPrefix} Initiated.`);

    if (!userId) {
      console.log(`${logPrefix} No Supabase user ID provided. Returning null.`);
      return null;
    }

    if (profileFetchControllerMapRef.current.has(userId) && !activeProfileFetches.has(userId)) {
        const oldControllerForUser = profileFetchControllerMapRef.current.get(userId);
        console.log(`${logPrefix} Found an old controller for user ${userId.substring(0,8)} without an active promise. Aborting it as 'StaleController'.`);
        oldControllerForUser?.abort("StaleController"); 
        profileFetchControllerMapRef.current.delete(userId);
    }
    
    if (activeProfileFetches.has(userId)) {
      console.log(`${logPrefix} Active fetch already in progress for user ${userId.substring(0,8)}. Returning existing promise.`);
      return activeProfileFetches.get(userId)!;
    }

    const controller = new AbortController();
    profileFetchControllerMapRef.current.set(userId, controller); 
    const signal = controller.signal;
    console.log(`${logPrefix} Created and stored new AbortController for user ${userId.substring(0,8)}.`);

    let timerId: number | undefined = undefined;

    const fetchPromise = (async (): Promise<AppUser | null> => {
      let queryResponse: { data: ProfileRow | null; error: any; status?: number; count?: number | null; } | null = null;
      const fallbackName = supabaseUser.user_metadata?.name || supabaseUser.email?.split('@')[0] || 'Usuário';
      let raceResult: any;

      try {
        console.log(`${logPrefix} Starting Supabase query for profile (user: ${userId.substring(0,8)}).`);
        const supabaseQueryPromise = supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .abortSignal(signal) // Corrected: abortSignal before single()
          .single<ProfileRow>(); 

        const timeoutPromise = new Promise((resolve) => {
          timerId = setTimeout(() => {
            console.warn(`${logPrefix} TIMEOUT after ${PROFILE_FETCH_TIMEOUT / 1000}s (user: ${userId.substring(0,8)}).`);
            resolve(TIMEOUT_SYMBOL);
          }, PROFILE_FETCH_TIMEOUT) as any; 
          
          signal.addEventListener('abort', () => {
            if (timerId) clearTimeout(timerId);
            timerId = undefined; 
            console.log(`${logPrefix} Timeout promise's signal was aborted (user: ${userId.substring(0,8)}). Reason: ${signal.reason}. Resolving with ABORT_SYMBOL_INTERNAL.`);
            resolve(ABORT_SYMBOL_INTERNAL);
          });
        });
        
        raceResult = await Promise.race([supabaseQueryPromise, timeoutPromise]);
        
        if (timerId && raceResult !== TIMEOUT_SYMBOL && raceResult !== ABORT_SYMBOL_INTERNAL) {
            clearTimeout(timerId);
            timerId = undefined;
        }
        
        if (signal.aborted && raceResult !== ABORT_SYMBOL_INTERNAL) { 
          console.warn(`${logPrefix} Fetch was EXTERNALLY ABORTED for user ${userId.substring(0,8)} (checked post-race). Reason: ${signal.reason}. Using fallback.`);
          return {
            id: userId, email: supabaseUser.email || '', name: `${fallbackName} (Abortado: ${signal.reason || 'Externo'})`,
            isSuperAdmin: (supabaseUser.email === SUPER_ADMIN_EMAIL), isActive: true, createdAt: supabaseUser.created_at,
            isFallback: true,
          };
        }

        if (raceResult === ABORT_SYMBOL_INTERNAL) {
             console.warn(`${logPrefix} Fetch was ABORTED (signal listener path) for user ${userId.substring(0,8)}. Reason: ${signal.reason}. Using fallback.`);
             return {
                id: userId, email: supabaseUser.email || '', name: `${fallbackName} (Abortado Interno: ${signal.reason || 'Sinal'})`,
                isSuperAdmin: (supabaseUser.email === SUPER_ADMIN_EMAIL), isActive: true, createdAt: supabaseUser.created_at,
                isFallback: true,
             };
        }
        
        if (raceResult === TIMEOUT_SYMBOL) {
          console.warn(`${logPrefix} Supabase query TIMED OUT for user ${userId.substring(0,8)} (race winner). Aborting controller. Using fallback. Check Supabase query performance.`);
          controller.abort("ProfileFetchTimeoutByRace"); 
          queryResponse = { data: null, error: { message: 'Profile fetch timed out', name: 'TIMEOUT_RACE' } };
        } else {
          queryResponse = raceResult as { data: ProfileRow | null; error: any; status?: number; count?: number | null; };
          console.log(`${logPrefix} Supabase query completed for user ${userId.substring(0,8)}. Error: ${!!queryResponse.error}, Data: ${!!queryResponse.data}`);
        }

        const { data: profileData, error: profileError } = queryResponse;

        if (profileError) {
          let errorName = profileError.name || 'N/A';
          if (profileError.message?.toLowerCase().includes('fetch aborted') || profileError.name === 'AbortError') {
             errorName = 'FetchAbort'; 
          }
          console.warn(`${logPrefix} Error fetching profile for user ${userId.substring(0,8)} (status: ${queryResponse?.status}, name: ${errorName}, code: ${profileError.code}):`, profileError.message);
          return {
            id: userId, email: supabaseUser.email || '', name: `${fallbackName} (Erro Perfil DB: ${errorName})`,
            isSuperAdmin: (supabaseUser.email === SUPER_ADMIN_EMAIL), isActive: true, createdAt: supabaseUser.created_at,
            isFallback: true,
          };
        }

        if (!profileData) { 
          console.warn(`${logPrefix} Profile data is null for user ${userId.substring(0,8)} though no error reported. Using fallback.`);
          return {
              id: userId, email: supabaseUser.email || '', name: `${fallbackName} (Perfil Vazio DB)`,
              isSuperAdmin: (supabaseUser.email === SUPER_ADMIN_EMAIL), isActive: true, createdAt: supabaseUser.created_at,
              isFallback: true,
          };
        }
        console.log(`${logPrefix} Successfully fetched profile data for user ${userId.substring(0,8)}.`);
        return {
          id: userId, email: supabaseUser.email || (profileData.email || ''),
          name: profileData.name || supabaseUser.user_metadata?.name || supabaseUser.email?.split('@')[0] || 'Usuário',
          isSuperAdmin: (profileData.is_super_admin ?? false) || (supabaseUser.email === SUPER_ADMIN_EMAIL),
          isActive: profileData.is_active ?? true, createdAt: profileData.created_at || supabaseUser.created_at,
          isFallback: false,
        };

      } catch (fetchError: any) {
        if (timerId) { clearTimeout(timerId); timerId = undefined; }
        if (fetchError.name === 'AbortError' || signal.aborted) {
          console.warn(`${logPrefix} GENERAL CATCH: Fetch aborted for user ${userId.substring(0,8)}. Reason: ${signal.reason || fetchError.message}. Using fallback.`);
           return {
            id: userId, email: supabaseUser.email || '', name: `${fallbackName} (Abortado no Catch: ${signal.reason || fetchError.message})`,
            isSuperAdmin: (supabaseUser.email === SUPER_ADMIN_EMAIL), isActive: true, createdAt: supabaseUser.created_at,
            isFallback: true,
          };
        } else {
          console.error(`${logPrefix} GENERAL CATCH: Exception during profile fetch for user ${userId.substring(0,8)}:`, fetchError.message, fetchError.stack, fetchError);
        }
        return {
          id: userId, email: supabaseUser.email || '', name: `${fallbackName} (Exceção Perfil)`,
          isSuperAdmin: (supabaseUser.email === SUPER_ADMIN_EMAIL), isActive: true, createdAt: supabaseUser.created_at,
          isFallback: true,
        };
      } finally {
         if (timerId) { clearTimeout(timerId); timerId = undefined; }

         activeProfileFetches.delete(userId);
         if (profileFetchControllerMapRef.current.get(userId) === controller) {
            profileFetchControllerMapRef.current.delete(userId);
            console.log(`${logPrefix} Cleared AbortController for user ${userId.substring(0,8)} from map.`);
         } else {
            console.log(`${logPrefix} AbortController for user ${userId.substring(0,8)} was already replaced or removed from map (or never set for this specific 'controller' instance if an earlier one was used).`);
         }
         console.log(`${logPrefix} Finished and removed from active fetches map (user: ${userId.substring(0,8)}).`);
      }
    })();
    
    activeProfileFetches.set(userId, fetchPromise);
    return fetchPromise;

  }, []); 

  const processSessionAndUser = useCallback(async (currentSession: Session | null, source: string) => {
    const logPrefix = `AuthContext:processSessionAndUser(source: ${source}) -`;
    console.log(`${logPrefix} Initiated. Current session available: ${!!currentSession}. Mounted: ${mountedRef.current}`);

    if (!mountedRef.current) {
      console.log(`${logPrefix} Component not mounted. Aborting.`);
      return;
    }

    setIsLoading(true); 

    try {
      let newAppProfile: AppUser | null = null;

      if (currentSession?.user) {
        console.log(`${logPrefix} Session exists. Fetching user profile for ${currentSession.user.id.substring(0,8)}...`);
        newAppProfile = await fetchUserProfile(currentSession.user, source);
        console.log(`${logPrefix} Profile fetched for ${currentSession.user.id.substring(0,8)}. User data (from ${source}):`, newAppProfile ? {email: newAppProfile.email, name: newAppProfile.name, isSuperAdmin: newAppProfile.isSuperAdmin, isActive: newAppProfile.isActive, isFallback: newAppProfile.isFallback } : null);
      } else {
        console.log(`${logPrefix} No session or user in session. AppUser will be null.`);
      }

      if (mountedRef.current) {
        setUser(prevUser => {
          if (prevUser && !prevUser.isFallback && newAppProfile && newAppProfile.isFallback) {
            console.warn(`${logPrefix} Profile refresh for user ${prevUser.id.substring(0,8)} resulted in a fallback. Keeping existing valid profile. Fallback details:`, newAppProfile.name);
            setSession(currentSession); 
            return prevUser; 
          }
          setSession(currentSession); 
          console.log(`${logPrefix} User state updated. IsAuthenticated (next render): ${!!(currentSession && newAppProfile && (newAppProfile.isActive ?? true) && !newAppProfile.isFallback )}`);
          return newAppProfile; 
        });
      } else {
         console.log(`${logPrefix} Component unmounted before user state could be updated.`);
      }
    } catch (e: any) {
      console.error(`${logPrefix} Error:`, e.message, e.stack);
      if (mountedRef.current) {
        setUser(null); 
        setSession(null); 
      }
    } finally {
      if (mountedRef.current) {
        console.log(`${logPrefix} Process finished. Setting isLoading to false.`);
        setIsLoading(false);
      } else {
        console.log(`${logPrefix} Process finished, but component unmounted. isLoading state not changed here.`);
      }
    }
  }, [fetchUserProfile]); 

  useEffect(() => {
    mountedRef.current = true;
    console.log("AuthProvider:useEffect[] - Component mounted. Initializing auth state.");
    setIsLoading(true); 
    supabase.auth.getSession()
      .then(async ({ data: { session: initialSession } }) => {
        console.log("AuthProvider:useEffect[] - Initial getSession returned. Session exists:", !!initialSession);
        if (!mountedRef.current) {
          console.log("AuthProvider:useEffect[] - Component unmounted before initial session processing.");
          return;
        }
        await processSessionAndUser(initialSession, "initialGetSession");
      })
      .catch(err => {
        if (mountedRef.current) {
          console.error("AuthProvider:useEffect[] - Error fetching initial session:", err);
          setUser(null);
          setSession(null);
          setIsLoading(false); 
        }
      });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        const currentLocalUser = user; 
        const currentLocalSession = session; 
        
        console.log(`AuthProvider:onAuthStateChange - Event: ${_event}, New session available: ${!!newSession}.`);
        if (!mountedRef.current) {
          console.log("AuthProvider:onAuthStateChange - Component unmounted. Ignoring event.");
          return;
        }
        
        if (_event === 'TOKEN_REFRESHED' && newSession?.user?.id === currentLocalSession?.user?.id && currentLocalUser && !currentLocalUser.isFallback) {
            console.log(`AuthProvider:onAuthStateChange (TOKEN_REFRESHED) - Token refreshed for same user ${currentLocalUser.id.substring(0,8)}. Session and existing valid profile retained. New access token will be available via context.`);
            setSession(newSession); 
            return; 
        }
        await processSessionAndUser(newSession, `onAuthStateChange:${_event}`);
      }
    );
    console.log("AuthProvider:useEffect[] - onAuthStateChange listener subscribed.");

    return () => {
      console.log("AuthProvider:useEffect[] - Cleanup. Component unmounting.");
      mountedRef.current = false;
      authListener?.subscription?.unsubscribe();
      console.log("AuthProvider:useEffect[] - onAuthStateChange listener unsubscribed.");
      
      profileFetchControllerMapRef.current.forEach((controller, userIdForController) => {
        console.log(`AuthProvider:useEffect[] - Aborting in-flight profile fetch for user ${userIdForController.substring(0,8)} from cleanup. Reason: AuthProviderUnmount`);
        controller.abort("AuthProviderUnmount");
      });
      profileFetchControllerMapRef.current.clear(); 
      activeProfileFetches.clear(); 
    };
  }, [processSessionAndUser]); 

  const login = useCallback(async (email: string, password_not_name: string) => {
    console.log("AuthContext:login - Attempting login for", email);
    if (!mountedRef.current) { console.log("AuthContext:login - Not mounted, aborting."); return; }
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password: password_not_name });
      if (error) throw error;
      console.log("AuthContext:login - signInWithPassword successful for", email, ". onAuthStateChange will handle session update.");
    } catch (error: any) {
      console.error("AuthContext:login - Error:", error.message, error.stack);
      if (mountedRef.current) setIsLoading(false); 
      throw new Error(error.message || 'Falha no login.');
    }
  }, []);

  const register = useCallback(async (email: string, name: string, password_not_name: string) => {
    console.log("AuthContext:register - Attempting registration for", email);
    if (!mountedRef.current) { console.log("AuthContext:register - Not mounted, aborting."); return; }
    setIsLoading(true);
    try {
      const { data: signUpResponse, error: signUpError } = await supabase.auth.signUp({
        email,
        password: password_not_name,
        options: { data: { name: name } },
      });
      if (signUpError) throw signUpError;
      if (!signUpResponse.user) throw new Error("Registro falhou, usuário não retornado.");
      console.log("AuthContext:register - signUp successful for", email, ". User ID:", signUpResponse.user.id.substring(0,8),". onAuthStateChange may handle session update if no email confirmation needed.");
    } catch (error: any) {
      console.error("AuthContext:register - FULL ERROR OBJECT:", error);
      if (mountedRef.current) setIsLoading(false);
      let displayMessage = 'Falha no registro.';
       if (error.message) {
            if (error.message.includes("User already registered")) {
                displayMessage = "Este e-mail já está cadastrado. Tente fazer login ou redefinir sua senha.";
            } else if (error.message.includes("Password should be at least 6 characters")) {
                displayMessage = "A senha deve ter no mínimo 6 caracteres.";
            } else if (error.message.includes("Unable to validate email address")) {
                displayMessage = "O endereço de e-mail fornecido não é válido.";
            } else {
                displayMessage = error.message;
            }
        }
      throw new Error(displayMessage);
    }
  }, []);

  const logout = useCallback(async () => {
    console.log("AuthContext:logout - Attempting logout.");
    if (!mountedRef.current) { console.log("AuthContext:logout - Not mounted, aborting."); return; }
    
    const { data: { session: currentActiveSupabaseSession } } = await supabase.auth.getSession();
    const currentUserId = currentActiveSupabaseSession?.user?.id;

    if (currentUserId) {
        const controller = profileFetchControllerMapRef.current.get(currentUserId);
        if (controller) {
            console.log(`AuthContext:logout - Aborting profile fetch for user ${currentUserId.substring(0,8)} before signOut. Reason: UserLogout`);
            controller.abort("UserLogout");
        }
        activeProfileFetches.delete(currentUserId); 
    }

    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("AuthContext:logout - Error during signOut:", error.message, error.stack);
    }
    console.log("AuthContext:logout - signOut called. onAuthStateChange will handle state changes.");
  }, []); 

  const requestPasswordReset = useCallback(async (email: string) => {
    console.log("AuthContext:requestPasswordReset - Requesting for", email);
    if (!mountedRef.current) return;
    try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}${window.location.pathname}#/auth`, 
        });
        if (error) throw error;
        console.log("AuthContext:requestPasswordReset - Email sent for", email);
    } catch (error: any) {
        console.error("AuthContext:requestPasswordReset - Error:", error.message, error.stack);
        throw new Error(error.message || 'Falha ao solicitar redefinição de senha.');
    }
  }, []);

  const isAuthenticatedValue = !!session && !!user && (user.isActive ?? true) && !user.isFallback;
  const isSuperAdminValue = isAuthenticatedValue && (user?.isSuperAdmin ?? false);
  const accessTokenValue = session?.access_token || null; 

  const contextValue = useMemo(() => {
    return {
      user,
      session,
      accessToken: accessTokenValue,
      isAuthenticated: isAuthenticatedValue,
      isSuperAdmin: isSuperAdminValue,
      login,
      register,
      logout,
      requestPasswordReset,
      isLoading, 
    };
  }, [user, session, accessTokenValue, isAuthenticatedValue, isSuperAdminValue, login, register, logout, requestPasswordReset, isLoading]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    console.error('CRITICAL ERROR in useAuth: useContext(AuthContext) returned undefined. This means AuthProvider is not wrapping the component, or there is a serious React Context/module resolution issue.');
    throw new Error('useAuth must be used within an AuthProvider. Context was undefined inside useAuth. Check component tree and module imports.');
  }
  return context;
};

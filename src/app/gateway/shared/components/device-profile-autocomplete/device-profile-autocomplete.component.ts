///
/// Copyright © 2016-2025 The Thingsboard Authors
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///
/// Unless required by applicable law or agreed to in writing, software
/// distributed under the License is distributed on an "AS IS" BASIS,
/// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
/// See the License for the specific language governing permissions and
/// limitations under the License.
///

import { Component, ElementRef, forwardRef, OnInit, ViewChild, ChangeDetectorRef, ViewEncapsulation } from '@angular/core';
import { MatAutocompleteTrigger } from '@angular/material/autocomplete';
import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
  UntypedFormControl,
} from '@angular/forms';
import { Observable, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, shareReplay, startWith, switchMap } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import {
  SharedModule,
  TruncatePipe,
  PageLink,
  Direction,
  DeviceProfileInfo,
  DeviceProfile,
  DeviceProfileType,
  DeviceTransportType,
  DeviceProvisionType,
  emptyPageData,
} from '@shared/public-api';
import { DeviceProfileService } from '@core/public-api';

@Component({
  selector: 'tb-device-profile-name-autocomplete',
  templateUrl: './device-profile-autocomplete.component.html',
  styleUrls: ['./device-profile-autocomplete.component.scss'],
  providers: [{
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => DeviceProfileNameAutocompleteComponent),
    multi: true,
  }],
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  imports: [
    CommonModule,
    SharedModule,
  ],
})
export class DeviceProfileNameAutocompleteComponent implements ControlValueAccessor, OnInit {

  @ViewChild('profileInput', { static: true }) profileInput: ElementRef;
  @ViewChild(MatAutocompleteTrigger) autocompleteTrigger: MatAutocompleteTrigger;

  profileControl = new UntypedFormControl('');
  searchText = '';
  filteredProfiles$: Observable<DeviceProfileInfo[]>;

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  constructor(
    public truncate: TruncatePipe,
    private deviceProfileService: DeviceProfileService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.filteredProfiles$ = this.profileControl.valueChanges.pipe(
      startWith(''),
      debounceTime(150),
      distinctUntilChanged(),
      switchMap(value => {
        const text = typeof value === 'string' ? value : (value?.name ?? '');
        this.searchText = text;
        return this.fetchProfiles(text);
      }),
      shareReplay(1),
    );

    this.profileControl.valueChanges.subscribe(value => {
      if (typeof value === 'string') {
        this.onChange(value);
      } else if (value?.name) {
        this.onChange(value.name);
      }
    });
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  writeValue(value: string | null): void {
    this.profileControl.patchValue(value ?? '', { emitEvent: false });
  }

  setDisabledState(isDisabled: boolean): void {
    if (isDisabled) {
      this.profileControl.disable({ emitEvent: false });
    } else {
      this.profileControl.enable({ emitEvent: false });
    }
  }

  displayFn(profile: DeviceProfileInfo | string): string {
    if (!profile) return '';
    return typeof profile === 'string' ? profile : profile.name;
  }

  onProfileSelected(profile: DeviceProfileInfo): void {
    this.profileControl.patchValue(profile.name, { emitEvent: true });
  }

  clear(): void {
    this.profileControl.patchValue('', { emitEvent: true });
    setTimeout(() => {
      this.profileInput.nativeElement.blur();
      this.profileInput.nativeElement.focus();
    }, 0);
  }

  createNewProfile(event: MouseEvent): void {
    event.stopPropagation();
    const profileName = this.searchText?.trim();
    if (!profileName) return;

    const newProfile: DeviceProfile = {
      name: profileName,
      type: DeviceProfileType.DEFAULT,
      transportType: DeviceTransportType.DEFAULT,
      provisionType: DeviceProvisionType.DISABLED,
      profileData: {
        configuration: { type: DeviceProfileType.DEFAULT },
        transportConfiguration: { type: DeviceTransportType.DEFAULT },
      },
      default: false,
    } as DeviceProfile;

    this.deviceProfileService.saveDeviceProfile(newProfile).subscribe({
      next: (saved) => {
        this.selectAndClose(saved.name);
      },
      error: () => {
        // Profile likely already exists (unique constraint) — just use the typed name
        this.selectAndClose(profileName);
      },
    });
  }

  private selectAndClose(name: string): void {
    this.autocompleteTrigger?.closePanel();
    this.profileControl.patchValue(name, { emitEvent: true });
    this.profileInput.nativeElement.blur();
    this.cdr.markForCheck();
  }

  private fetchProfiles(searchText: string): Observable<DeviceProfileInfo[]> {
    const pageLink = new PageLink(10, 0, searchText, {
      property: 'name',
      direction: Direction.ASC,
    });
    return this.deviceProfileService.getDeviceProfileInfos(pageLink, null, { ignoreLoading: true }).pipe(
      catchError(() => of(emptyPageData<DeviceProfileInfo>())),
      map(pageData => pageData.data),
    );
  }
}
